import frappe
from frappe import _
from frappe.model.document import Document


class PremiumRateTable(Document):
    def validate(self):
        self._validate_rate()
        self._validate_age_range()
        self._validate_term_range()
        self._validate_vehicle_range()
        self._validate_capital_range()

    def _validate_rate(self):
        if not self.base_rate_pct or self.base_rate_pct <= 0:
            frappe.throw(_("A taxa base deve ser um valor positivo maior que zero."))

    def _validate_age_range(self):
        if self.min_age and self.max_age and self.min_age >= self.max_age:
            frappe.throw(_("A faixa de idade mínima deve ser menor que a máxima."))

    def _validate_term_range(self):
        if self.min_term_months and self.max_term_months and self.min_term_months >= self.max_term_months:
            frappe.throw(_("O prazo mínimo deve ser menor que o prazo máximo."))

    def _validate_vehicle_range(self):
        if self.min_vehicle_year and self.max_vehicle_year and self.min_vehicle_year >= self.max_vehicle_year:
            frappe.throw(_("O ano mínimo do veículo deve ser menor que o máximo."))

    def _validate_capital_range(self):
        if self.min_sum_insured and self.max_sum_insured and self.min_sum_insured >= self.max_sum_insured:
            frappe.throw(_("O capital mínimo deve ser menor que o capital máximo."))


@frappe.whitelist()
def get_applicable_rate(product, age=None, term_months=None, sum_insured=None, vehicle_year=None):
    """
    Find the best matching rate row for a given product and parameters.
    Called from the quotation server-side calculation.
    Returns the matching PremiumRateTable document name and base_rate_pct.
    """
    filters = {"product": product, "is_active": 1}

    candidates = frappe.get_all(
        "Premium Rate Table",
        filters=filters,
        fields=[
            "name", "base_rate_pct",
            "min_age", "max_age",
            "min_term_months", "max_term_months",
            "min_sum_insured", "max_sum_insured",
            "min_vehicle_year", "max_vehicle_year",
        ],
    )

    for row in candidates:
        if not _row_matches(row, age, term_months, sum_insured, vehicle_year):
            continue
        return {"name": row.name, "base_rate_pct": row.base_rate_pct}

    return None


def _row_matches(row, age, term_months, sum_insured, vehicle_year):
    age = frappe.utils.cint(age)
    term_months = frappe.utils.cint(term_months)
    sum_insured = frappe.utils.flt(sum_insured)
    vehicle_year = frappe.utils.cint(vehicle_year)

    if row.min_age and age and age < row.min_age:
        return False
    if row.max_age and age and age > row.max_age:
        return False
    if row.min_term_months and term_months and term_months < row.min_term_months:
        return False
    if row.max_term_months and term_months and term_months > row.max_term_months:
        return False
    if row.min_sum_insured and sum_insured and sum_insured < row.min_sum_insured:
        return False
    if row.max_sum_insured and sum_insured and sum_insured > row.max_sum_insured:
        return False
    if row.min_vehicle_year and vehicle_year and vehicle_year < row.min_vehicle_year:
        return False
    if row.max_vehicle_year and vehicle_year and vehicle_year > row.max_vehicle_year:
        return False

    return True
