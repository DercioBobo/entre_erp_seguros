import frappe
from frappe.utils import nowdate, add_days


@frappe.whitelist()
def get_dashboard_stats():
	today = nowdate()
	in_30 = add_days(today, 30)

	stats = frappe.db.sql("""
		SELECT
			COUNT(CASE WHEN policy_status = 'Activa' THEN 1 END)                              AS active_policies,
			COUNT(CASE WHEN policy_status = 'Pendente de Pagamento' THEN 1 END)               AS pending_payment,
			COALESCE(SUM(CASE WHEN policy_status = 'Activa' THEN sum_insured   ELSE 0 END),0) AS total_capital,
			COALESCE(SUM(CASE WHEN policy_status = 'Activa' THEN premium_amount ELSE 0 END),0) AS total_premium,
			COUNT(CASE WHEN policy_status = 'Activa'
				AND coverage_end_date BETWEEN %(today)s AND %(in30)s THEN 1 END)              AS expiring_30d
		FROM `tabInsurance Policy`
	""", {"today": today, "in30": in_30}, as_dict=True)[0]

	claim_stats = frappe.db.sql("""
		SELECT
			COUNT(CASE WHEN status NOT IN ('Liquidado','Cancelado','Rejeitado') THEN 1 END) AS open_claims,
			COUNT(CASE WHEN status = 'Em Liquidação' THEN 1 END)                            AS settling_claims
		FROM `tabInsurance Claim`
	""", as_dict=True)[0]

	stats.update(claim_stats)
	return stats


@frappe.whitelist()
def search_customers(query, limit=20):
	safe = frappe.db.escape(f"%{query}%")
	limit = min(int(limit), 100)

	rows = frappe.db.sql(f"""
		SELECT
			p.customer,
			p.customer_full_name,
			MAX(p.customer_phone_ins)                                                          AS phone,
			COUNT(CASE WHEN p.policy_status = 'Activa' THEN 1 END)                            AS active_count,
			COUNT(DISTINCT p.name)                                                             AS total_policies,
			COALESCE(SUM(CASE WHEN p.policy_status = 'Activa' THEN p.sum_insured ELSE 0 END),0) AS total_capital,
			COUNT(CASE WHEN c.status NOT IN ('Liquidado','Cancelado','Rejeitado') THEN 1 END)  AS open_claims,
			GROUP_CONCAT(DISTINCT p.branch ORDER BY p.branch SEPARATOR ', ')                   AS branches
		FROM `tabInsurance Policy` p
		LEFT JOIN `tabInsurance Claim` c ON c.policy = p.name
		WHERE p.customer_full_name LIKE {safe}
		   OR p.customer          LIKE {safe}
		   OR p.customer_phone_ins LIKE {safe}
		GROUP BY p.customer, p.customer_full_name
		ORDER BY active_count DESC, p.customer_full_name ASC
		LIMIT {limit}
	""", as_dict=True)

	return rows


@frappe.whitelist()
def get_customer_detail(customer):
	profile = frappe.db.get_value(
		"Customer", customer,
		["customer_name", "customer_full_name", "customer_bi", "customer_nuit",
		 "customer_dob", "customer_age", "customer_gender",
		 "customer_phone_ins", "customer_address_ins"],
		as_dict=True,
	) or {}

	policies = frappe.db.get_all(
		"Insurance Policy",
		filters={"customer": customer},
		fields=["name", "insurance_product", "branch", "policy_status",
		        "coverage_start_date", "coverage_end_date",
		        "sum_insured", "premium_amount"],
		order_by="creation desc",
	)

	claims = frappe.db.get_all(
		"Insurance Claim",
		filters={"customer": customer},
		fields=["name", "policy", "status", "incident_date", "claim_type",
		        "claimed_amount", "approved_amount"],
		order_by="creation desc",
		limit=30,
	)

	payments = frappe.db.get_all(
		"Premium Payment",
		filters={"customer": customer},
		fields=["name", "policy", "amount", "payment_date", "payment_method", "status"],
		order_by="creation desc",
		limit=30,
	)

	endorsements = frappe.db.get_all(
		"Policy Endorsement",
		filters={"customer": customer},
		fields=["name", "policy", "endorsement_type", "status",
		        "effective_date", "additional_premium"],
		order_by="creation desc",
		limit=30,
	)

	return {
		"profile": profile,
		"policies": policies,
		"claims": claims,
		"payments": payments,
		"endorsements": endorsements,
	}
