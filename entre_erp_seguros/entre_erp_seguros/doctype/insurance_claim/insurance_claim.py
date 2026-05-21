import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, nowdate, add_days


class InsuranceClaim(Document):

    def validate(self):
        self._validate_policy_active()
        self._validate_incident_date()
        self._validate_amounts()
        self._calculate_net_payable()

    # ------------------------------------------------------------------
    # Validate helpers
    # ------------------------------------------------------------------

    def _validate_policy_active(self):
        if not self.policy:
            return
        policy_status = frappe.db.get_value("Insurance Policy", self.policy, "policy_status")
        if policy_status not in ("Activa", "Sinistrada"):
            frappe.throw(
                _("Só é possível registar sinistros em apólices Activas. "
                  "Estado actual da apólice: {0}.").format(policy_status)
            )
        if policy_status == "Sinistrada":
            self._check_duplicate_claim()

    def _check_duplicate_claim(self):
        terminal = ("Liquidado", "Cancelado", "Rejeitado")
        filters = {
            "policy": self.policy,
            "status": ["not in", list(terminal)],
        }
        if self.name:
            filters["name"] = ["!=", self.name]
        existing = frappe.db.get_value("Insurance Claim", filters, "name")
        if existing:
            frappe.throw(
                _("A apólice {0} já tem uma participação de sinistro em aberto ({1}). "
                  "Conclua ou cancele o sinistro existente antes de abrir um novo.").format(
                    self.policy, existing
                )
            )

    def _validate_incident_date(self):
        if not self.incident_date or not self.policy:
            return
        start, end = frappe.db.get_value(
            "Insurance Policy", self.policy, ["coverage_start_date", "coverage_end_date"]
        )
        incident = getdate(self.incident_date)
        if start and incident < getdate(start):
            frappe.throw(_("A data do sinistro é anterior ao início de cobertura da apólice."))
        if end and incident > getdate(end):
            frappe.throw(_("A data do sinistro é posterior ao fim de cobertura da apólice."))

    def _validate_amounts(self):
        if self.approved_amount and self.claimed_amount and self.approved_amount > self.claimed_amount:
            frappe.msgprint(
                _("Nota: o valor aprovado ({0} MT) é superior ao valor reclamado ({1} MT).").format(
                    self.approved_amount, self.claimed_amount
                ),
                indicator="orange",
            )
        if self.approved_amount and self.sum_insured and self.approved_amount > self.sum_insured:
            frappe.throw(
                _("O valor aprovado não pode ser superior ao capital segurado ({0} MT).").format(
                    self.sum_insured
                )
            )

    def _calculate_net_payable(self):
        approved = self.approved_amount or 0
        deductible = self.deductible_amount or 0
        self.net_payable_amount = max(0, approved - deductible)

    def _check_waiting_period(self):
        """Set is_within_waiting_period based on product's waiting_period_days."""
        if not self.policy or not self.incident_date:
            return
        try:
            # Read from policy directly — fetch_from fields are not reliably
            # populated on self during server-side @frappe.whitelist() calls.
            insurance_product, activation_date = frappe.db.get_value(
                "Insurance Policy", self.policy,
                ["insurance_product", "activation_date"]
            )
            if not insurance_product or not activation_date:
                return

            waiting_days = frappe.db.get_value(
                "Insurance Product", insurance_product, "waiting_period_days"
            ) or 0
            if waiting_days <= 0:
                return

            carencia_end = getdate(add_days(activation_date, waiting_days))
            within = getdate(self.incident_date) <= carencia_end
            self.db_set("is_within_waiting_period", 1 if within else 0)
        except Exception:
            frappe.log_error(
                title=f"Erro ao verificar período de carência — {self.name}",
                message=frappe.get_traceback(),
            )

    # ------------------------------------------------------------------
    # Workflow transitions
    # ------------------------------------------------------------------

    @frappe.whitelist()
    def submit_claim(self):
        if self.status != "Rascunho":
            frappe.throw(_("Só é possível submeter participações em estado Rascunho."))

        policy_status = frappe.db.get_value("Insurance Policy", self.policy, "policy_status")
        if policy_status not in ("Activa", "Sinistrada"):
            frappe.throw(
                _("A apólice {0} não está activa (estado: {1}).").format(
                    self.policy, policy_status
                )
            )

        self._check_waiting_period()
        self.db_set("status", "Submetido")
        self.db_set("submission_date", nowdate())

        if self.is_within_waiting_period:
            frappe.msgprint(
                _("Participação submetida. AVISO: a data do sinistro está dentro do período de "
                  "carência do produto. O analista deverá avaliar a cobertura aplicável."),
                indicator="orange",
                title=_("Período de Carência"),
            )

    @frappe.whitelist()
    def start_analysis(self):
        if self.status not in ("Submetido", "Pendente Documentação"):
            frappe.throw(
                _("Só é possível iniciar análise em sinistros Submetidos ou Pendentes de Documentação.")
            )
        self.db_set("status", "Em Análise")
        if not self.analyst:
            self.db_set("analyst", frappe.session.user)
        if not self.analysis_start_date:
            self.db_set("analysis_start_date", nowdate())

    @frappe.whitelist()
    def request_documents(self, note=None):
        if self.status not in ("Em Análise", "Submetido"):
            frappe.throw(_("Só é possível solicitar documentos em sinistros Em Análise ou Submetidos."))
        self.db_set("status", "Pendente Documentação")
        if note:
            self.db_set("pending_documents_note", note)

    @frappe.whitelist()
    def approve_claim(self):
        if self.status not in ("Em Análise", "Pendente Documentação"):
            frappe.throw(
                _("Só é possível aprovar sinistros Em Análise ou Pendentes de Documentação.")
            )
        if not self.approved_amount or self.approved_amount <= 0:
            frappe.throw(_("Preencha o valor aprovado antes de aprovar o sinistro."))
        if self.sum_insured and self.approved_amount > self.sum_insured:
            frappe.throw(
                _("O valor aprovado não pode ser superior ao capital segurado ({0} MT).").format(
                    self.sum_insured
                )
            )

        net = max(0, (self.approved_amount or 0) - (self.deductible_amount or 0))
        self.db_set("net_payable_amount", net)
        self.db_set("status", "Aprovado")
        self.db_set("decision_date", nowdate())
        frappe.db.set_value("Insurance Policy", self.policy, "policy_status", "Sinistrada")

    @frappe.whitelist()
    def reject_claim(self, reason):
        if self.status not in ("Em Análise", "Pendente Documentação"):
            frappe.throw(
                _("Só é possível rejeitar sinistros Em Análise ou Pendentes de Documentação.")
            )
        if not reason:
            frappe.throw(_("Indique o motivo de rejeição."))
        self.db_set("status", "Rejeitado")
        self.db_set("rejection_reason", reason)
        self.db_set("decision_date", nowdate())

    @frappe.whitelist()
    def start_settlement(self):
        if self.status != "Aprovado":
            frappe.throw(_("Só é possível iniciar liquidação em sinistros Aprovados."))
        self.db_set("status", "Em Liquidação")

    @frappe.whitelist()
    def confirm_settlement(self):
        if self.status != "Em Liquidação":
            frappe.throw(_("Só é possível confirmar liquidação em sinistros Em Liquidação."))
        if not self.payment_method:
            frappe.throw(_("Seleccione o método de pagamento da indemnização antes de liquidar."))
        if not self.beneficiary_name:
            frappe.throw(_("Preencha o nome do beneficiário antes de liquidar."))

        net = self.net_payable_amount or max(
            0, (self.approved_amount or 0) - (self.deductible_amount or 0)
        )
        if net <= 0:
            frappe.throw(_("O valor líquido a liquidar deve ser maior que zero."))

        company = (
            frappe.defaults.get_user_default("Company")
            or frappe.db.get_single_value("Global Defaults", "default_company")
        )
        mode_map = {
            "M-Pesa": "M-Pesa",
            "e-Mola": "e-Mola",
            "Transferência Bancária": "Bank",
            "Cheque": "Cheque",
        }
        mode = mode_map.get(self.payment_method, self.payment_method)

        try:
            # Payment Entry (Pay — outgoing to customer/beneficiary)
            pe = frappe.new_doc("Payment Entry")
            pe.update({
                "payment_type": "Pay",
                "party_type": "Customer",
                "party": self.customer,
                "company": company,
                "paid_amount": net,
                "received_amount": net,
                "reference_no": self.name,
                "reference_date": nowdate(),
                "mode_of_payment": mode,
                "remarks": f"Indemnização Sinistro {self.name} — Apólice {self.policy}",
            })
            pe.insert(ignore_permissions=True)
            pe.submit()

            # Claim Settlement Receipt
            receipt = frappe.new_doc("Claim Settlement Receipt")
            receipt.update({
                "claim": self.name,
                "policy": self.policy,
                "customer": self.customer,
                "beneficiary_name": self.beneficiary_name,
                "beneficiary_bi": self.beneficiary_bi or "",
                "claim_type": self.claim_type,
                "incident_date": self.incident_date,
                "approved_amount": self.approved_amount,
                "deductible_amount": self.deductible_amount or 0,
                "net_paid_amount": net,
                "payment_method": self.payment_method,
                "payment_reference": pe.name,
                "payment_date": nowdate(),
                "issued_by": frappe.session.user,
            })
            receipt.insert(ignore_permissions=True)

            self.db_set("settlement_entry", pe.name)
            self.db_set("settlement_reference", receipt.name)
            self.db_set("settlement_date", nowdate())
            self.db_set("status", "Liquidado")

        except Exception:
            frappe.log_error(
                title=f"Erro ao liquidar sinistro {self.name}",
                message=frappe.get_traceback(),
            )
            frappe.throw(
                _("Erro ao processar a liquidação. Verifique a configuração contabilística e tente novamente.")
            )
