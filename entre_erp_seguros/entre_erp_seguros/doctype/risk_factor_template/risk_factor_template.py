import frappe
from frappe import _
from frappe.model.document import Document


class RiskFactorTemplate(Document):
    def validate(self):
        if not self.risk_factor_items:
            frappe.throw(_("O template deve ter pelo menos um factor de risco."))

        self._validate_unique_fieldnames()

    def _validate_unique_fieldnames(self):
        seen = set()
        for item in self.risk_factor_items:
            if not item.fieldname:
                continue
            if item.fieldname in seen:
                frappe.throw(
                    _("Nome de campo duplicado: '{0}'. Cada factor deve ter um nome de campo único.").format(
                        item.fieldname
                    )
                )
            seen.add(item.fieldname)
