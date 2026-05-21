import frappe
from frappe import _
from frappe.model.document import Document


class InsuranceProduct(Document):
    def validate(self):
        self._validate_age_range()
        self._validate_term_range()
        self._validate_capital_range()
        self._sync_status_with_active()

    def _validate_age_range(self):
        if self.min_age and self.max_age and self.min_age >= self.max_age:
            frappe.throw(_("A idade mínima deve ser menor que a idade máxima."))

    def _validate_term_range(self):
        if self.min_term_months and self.max_term_months and self.min_term_months >= self.max_term_months:
            frappe.throw(_("O prazo mínimo deve ser menor que o prazo máximo."))

    def _validate_capital_range(self):
        if self.min_sum_insured and self.max_sum_insured and self.min_sum_insured >= self.max_sum_insured:
            frappe.throw(_("O capital mínimo deve ser menor que o capital máximo."))

    def _sync_status_with_active(self):
        if self.status == "Descontinuado":
            self.is_active = 0
        elif self.status == "Activo":
            self.is_active = 1
