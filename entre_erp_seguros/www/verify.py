import frappe
from frappe.utils import formatdate

no_cache = 1


def get_context(context):
    policy_number = frappe.form_dict.get("p", "").strip()
    context.title = "Verificação de Apólice"
    context.no_breadcrumbs = True
    context.no_header = True

    if not policy_number:
        context.error = "Número de apólice não fornecido."
        return

    policy = frappe.db.get_value(
        "Insurance Policy",
        {"policy_number": policy_number},
        [
            "policy_number",
            "customer_full_name",
            "insurance_product",
            "branch",
            "sum_insured",
            "coverage_start_date",
            "coverage_end_date",
            "policy_status",
            "issued_date",
        ],
        as_dict=True,
    )

    if not policy:
        context.error = f"Apólice '{policy_number}' não encontrada."
        return

    context.policy = policy
    context.status_color = _status_color(policy.policy_status)
    context.formatted_start = formatdate(policy.coverage_start_date, "dd/MM/yyyy")
    context.formatted_end = formatdate(policy.coverage_end_date, "dd/MM/yyyy")
    context.formatted_issued = formatdate(policy.issued_date, "dd/MM/yyyy")


def _status_color(status):
    return {
        "Activa": "#2e7d32",
        "Pendente de Pagamento": "#f57c00",
        "Cancelada": "#c62828",
        "Expirada": "#546e7a",
        "Sinistrada": "#6a1b9a",
    }.get(status, "#546e7a")
