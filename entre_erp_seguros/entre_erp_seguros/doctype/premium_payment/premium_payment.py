import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import nowdate


class PremiumPayment(Document):

    def validate(self):
        if self.amount and self.amount <= 0:
            frappe.throw(_("O montante do pagamento deve ser maior que zero."))
        if not self.operator:
            self.operator = frappe.session.user
        self._check_duplicate_payment()

    def _check_duplicate_payment(self):
        if not self.policy:
            return
        filters = {
            "policy": self.policy,
            "status": "Submetido",
            "docstatus": 1,
        }
        if self.name:
            filters["name"] = ["!=", self.name]
        existing = frappe.db.get_value("Premium Payment", filters, "name")
        if existing:
            frappe.throw(
                _("Já existe um pagamento submetido ({0}) para a apólice {1}. "
                  "Não é possível registar um segundo pagamento.").format(existing, self.policy)
            )

    def before_submit(self):
        policy = frappe.get_doc("Insurance Policy", self.policy)
        if policy.docstatus != 1:
            frappe.throw(
                _("A apólice {0} ainda não foi submetida. Submeta a apólice antes de registar o pagamento.").format(
                    self.policy
                )
            )
        if policy.policy_status == "Activa":
            frappe.throw(_("A apólice {0} já se encontra activa.").format(self.policy))
        if policy.policy_status in ("Cancelada", "Expirada"):
            frappe.throw(
                _("Não é possível receber pagamento: a apólice {0} está {1}.").format(
                    self.policy, policy.policy_status
                )
            )

    def on_submit(self):
        self.db_set("status", "Submetido")
        self._activate_policy()
        self._create_invoice_and_payment()

    def on_cancel(self):
        self.db_set("status", "Cancelado")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _activate_policy(self):
        policy = frappe.get_doc("Insurance Policy", self.policy)
        policy.activate(payment_reference=self.name)

    def _create_invoice_and_payment(self):
        """
        1. Create and submit a Sales Invoice for the premium amount.
        2. Create a Payment Entry fully allocated against that invoice.
        Wrapped in try/except so the policy still activates even when
        accounting is not yet configured.
        """
        try:
            mode_map = {
                "Dinheiro": "Cash",
                "M-Pesa": "M-Pesa",
                "e-Mola": "e-Mola",
                "Transferência Bancária": "Bank",
                "Cheque": "Cheque",
            }
            mode = mode_map.get(self.payment_method, self.payment_method)
            customer = frappe.db.get_value("Insurance Policy", self.policy, "customer")
            company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")

            # --- Sales Invoice ---
            si = frappe.new_doc("Sales Invoice")
            si.update({
                "customer": customer,
                "company": company,
                "posting_date": self.payment_date or nowdate(),
                "due_date": self.payment_date or nowdate(),
                "remarks": f"Prémio da Apólice {self.policy} — {self.name}",
            })
            si.append("items", {
                "item_code": "Prémio de Seguro",
                "qty": 1,
                "rate": self.amount,
                "description": f"Prémio — Apólice {self.policy}",
            })
            si.insert(ignore_permissions=True)
            si.submit()

            # Store invoice reference on the payment record
            self.db_set("sales_invoice", si.name)

            # --- Payment Entry ---
            pe = frappe.new_doc("Payment Entry")
            pe.update({
                "payment_type": "Receive",
                "party_type": "Customer",
                "party": customer,
                "company": company,
                "paid_amount": self.amount,
                "received_amount": self.amount,
                "reference_no": self.payment_channel_reference or self.name,
                "reference_date": self.payment_date or nowdate(),
                "mode_of_payment": mode,
                "remarks": f"Prémio da Apólice {self.policy} — {self.name}",
            })
            pe.append("references", {
                "reference_doctype": "Sales Invoice",
                "reference_name": si.name,
                "allocated_amount": self.amount,
            })
            pe.insert(ignore_permissions=True)
            pe.submit()

            self.db_set("payment_entry", pe.name)

        except Exception:
            frappe.log_error(
                title=f"Erro ao criar lançamento contabilístico para {self.name}",
                message=frappe.get_traceback(),
            )
            frappe.msgprint(
                _("Pagamento registado mas não foi possível criar o lançamento contabilístico. "
                  "Verifique a configuração de contas e modos de pagamento."),
                indicator="orange",
                title=_("Aviso Contabilístico"),
            )
