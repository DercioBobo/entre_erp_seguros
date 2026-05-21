import frappe
from frappe import _
from frappe.model.document import Document


class AcceptanceRuleItem(Document):
    def validate(self):
        if self.action == "Aplicar Carregamento" and not self.loading_pct:
            frappe.throw(
                _("A regra '{0}' tem acção 'Aplicar Carregamento' mas sem percentagem definida.").format(
                    self.rule_description or "sem descrição"
                )
            )
