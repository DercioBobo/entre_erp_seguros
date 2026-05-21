import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, nowdate


class PolicyEndorsement(Document):

    def validate(self):
        self._validate_policy_status()
        self._validate_effective_date()

    # ------------------------------------------------------------------
    # Validate helpers
    # ------------------------------------------------------------------

    def _validate_policy_status(self):
        if not self.policy:
            return
        status = frappe.db.get_value("Insurance Policy", self.policy, "policy_status")
        if status not in ("Activa", "Pendente de Pagamento"):
            frappe.throw(
                _("Endossos só podem ser criados em apólices Activas ou Pendentes de Pagamento. "
                  "Estado actual: {0}.").format(status)
            )

    def _validate_effective_date(self):
        if not self.effective_date or not self.policy:
            return
        start, end = frappe.db.get_value(
            "Insurance Policy", self.policy, ["coverage_start_date", "coverage_end_date"]
        )
        eff = getdate(self.effective_date)
        if start and eff < getdate(start):
            frappe.throw(_("A data de vigência do endosso é anterior ao início da apólice."))
        if end and eff > getdate(end) and self.endorsement_type != "Extensão de Prazo":
            frappe.throw(_("A data de vigência do endosso é posterior ao fim da apólice."))

    # ------------------------------------------------------------------
    # Workflow transitions
    # ------------------------------------------------------------------

    @frappe.whitelist()
    def submit_endorsement(self):
        if self.status != "Rascunho":
            frappe.throw(_("Só é possível submeter endossos em estado Rascunho."))
        self._validate_policy_status()
        self.db_set("status", "Pendente de Aprovação")
        self.db_set("request_date", nowdate())

    @frappe.whitelist()
    def approve_endorsement(self):
        if self.status != "Pendente de Aprovação":
            frappe.throw(_("Só é possível aprovar endossos em estado Pendente de Aprovação."))
        self._apply_endorsement()
        self.db_set("status", "Aprovado")
        self.db_set("approved_by", frappe.session.user)
        self.db_set("approved_date", nowdate())

        if self.additional_premium and self.additional_premium > 0:
            frappe.msgprint(
                _("Endosso aprovado. Existe um prémio adicional de {0} MT a cobrar. "
                  "Registe o pagamento em Premium Payment.").format(
                    frappe.format(self.additional_premium, {"fieldtype": "Currency"})
                ),
                indicator="orange",
                title=_("Prémio Adicional a Cobrar"),
            )

    @frappe.whitelist()
    def reject_endorsement(self, reason):
        if self.status != "Pendente de Aprovação":
            frappe.throw(_("Só é possível recusar endossos em estado Pendente de Aprovação."))
        if not reason:
            frappe.throw(_("Indique o motivo de recusa."))
        self.db_set("status", "Recusado")
        self.db_set("rejection_reason", reason)

    # ------------------------------------------------------------------
    # Apply changes to the policy
    # ------------------------------------------------------------------

    def _apply_endorsement(self):
        etype = self.endorsement_type
        changes = []

        if etype == "Cancelamento":
            frappe.db.set_value(
                "Insurance Policy", self.policy,
                {
                    "policy_status": "Cancelada",
                    "cancellation_date": self.effective_date or nowdate(),
                    "cancellation_reason": self.description,
                }
            )
            changes.append(f"Apólice {self.policy} cancelada em {self.effective_date or nowdate()}.")

        elif etype in ("Aumento de Capital", "Redução de Capital"):
            if not self.new_value:
                frappe.throw(_("Preencha o campo 'Novo Valor' com o novo capital segurado (MT)."))
            try:
                new_capital = float(self.new_value.replace(",", "."))
            except (ValueError, AttributeError):
                frappe.throw(_("O Novo Valor deve ser um número (capital segurado em MT)."))
            old_capital = frappe.db.get_value("Insurance Policy", self.policy, "sum_insured") or 0
            frappe.db.set_value("Insurance Policy", self.policy, "sum_insured", new_capital)
            changes.append(
                f"Capital segurado alterado de {old_capital:,.2f} MT para {new_capital:,.2f} MT."
            )

        elif etype == "Extensão de Prazo":
            if not self.new_value:
                frappe.throw(_("Preencha o campo 'Novo Valor' com a nova data de fim de cobertura (AAAA-MM-DD)."))
            try:
                new_end = getdate(self.new_value)
            except Exception:
                frappe.throw(_("O Novo Valor deve ser uma data válida no formato AAAA-MM-DD."))
            old_end = frappe.db.get_value("Insurance Policy", self.policy, "coverage_end_date")
            frappe.db.set_value("Insurance Policy", self.policy, "coverage_end_date", new_end)
            changes.append(
                f"Prazo de cobertura estendido de {old_end} para {new_end}."
            )

        elif etype == "Adição de Cobertura":
            if not self.new_value:
                frappe.throw(_("Preencha o campo 'Novo Valor' com o nome exacto do Tipo de Cobertura a adicionar."))
            if not frappe.db.exists("Coverage Type", self.new_value):
                frappe.throw(
                    _("Tipo de Cobertura '{0}' não encontrado. Verifique o nome em Tipo de Cobertura.").format(
                        self.new_value
                    )
                )
            policy = frappe.get_doc("Insurance Policy", self.policy)
            existing = [c.coverage_type for c in (policy.coverages or [])]
            if self.new_value in existing:
                frappe.msgprint(
                    _("A cobertura '{0}' já existe na apólice.").format(self.new_value),
                    indicator="orange",
                )
            else:
                # Insert child row directly — policy is a submitted doc, save() is not allowed
                child = frappe.new_doc("Policy Coverage Item")
                child.update({
                    "parenttype": "Insurance Policy",
                    "parentfield": "coverages",
                    "parent": self.policy,
                    "coverage_type": self.new_value,
                    "is_active": 1,
                })
                child.insert(ignore_permissions=True)
            changes.append(f"Cobertura '{self.new_value}' adicionada à apólice.")

        elif etype == "Correcção de Dados":
            changes.append(f"Correcção de dados registada: {self.description}")
            if self.previous_value and self.new_value:
                changes.append(f"Anterior: {self.previous_value}  →  Novo: {self.new_value}")

        elif etype == "Substituição de Beneficiário":
            changes.append(
                "Substituição de beneficiário registada. "
                "Actualize manualmente a lista de beneficiários na apólice."
            )
            if self.new_value:
                changes.append(f"Novo beneficiário indicado: {self.new_value}")

        elif etype == "Alteração de Dados do Segurado":
            changes.append(f"Alteração de dados do segurado registada: {self.description}")
            if self.previous_value and self.new_value:
                changes.append(f"Anterior: {self.previous_value}  →  Novo: {self.new_value}")

        self.db_set("applied_changes", "\n".join(changes))
