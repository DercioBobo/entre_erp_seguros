import json
import re
from datetime import date

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_months, date_diff, getdate, nowdate


class InsuranceQuotation(Document):

    def validate(self):
        self._calc_age()
        self._calc_end_date()
        self._fetch_branch()

    # ------------------------------------------------------------------
    # Validate helpers
    # ------------------------------------------------------------------

    def _calc_age(self):
        if self.customer_dob:
            today = getdate(nowdate())
            dob = getdate(self.customer_dob)
            self.customer_age = (
                today.year - dob.year
                - ((today.month, today.day) < (dob.month, dob.day))
            )

    def _calc_end_date(self):
        if self.coverage_start_date and self.term_months:
            self.coverage_end_date = add_months(self.coverage_start_date, self.term_months)

    def _fetch_branch(self):
        if self.insurance_product and not self.branch:
            self.branch = frappe.db.get_value("Insurance Product", self.insurance_product, "branch")

    # ------------------------------------------------------------------
    # Button: Calcular Prémio
    # ------------------------------------------------------------------

    @frappe.whitelist()
    def calculate_premium(self):
        self._calc_age()
        self._fetch_branch()

        if not self.insurance_product:
            frappe.throw(_("Seleccione um produto de seguro antes de calcular o prémio."))
        if not self.sum_insured:
            frappe.throw(_("Indique o capital segurado."))
        if not self.term_months:
            frappe.throw(_("Indique o prazo em meses."))

        product = frappe.get_doc("Insurance Product", self.insurance_product)

        # 1. Age limits check
        if self.customer_age:
            if product.min_age and self.customer_age < product.min_age:
                frappe.throw(
                    _("Idade do cliente ({0} anos) abaixo do mínimo para este produto ({1} anos).").format(
                        self.customer_age, product.min_age
                    )
                )
            if product.max_age and self.customer_age > product.max_age:
                frappe.throw(
                    _("Idade do cliente ({0} anos) acima do máximo para este produto ({1} anos).").format(
                        self.customer_age, product.max_age
                    )
                )

        # 2. Sum insured limits
        if product.min_sum_insured and self.sum_insured < product.min_sum_insured:
            frappe.throw(
                _("Capital segurado abaixo do mínimo permitido ({0} MT).").format(product.min_sum_insured)
            )
        if product.max_sum_insured and self.sum_insured > product.max_sum_insured:
            frappe.throw(
                _("Capital segurado acima do máximo permitido ({0} MT).").format(product.max_sum_insured)
            )

        # 3. Find base rate
        base_rate = self._get_base_rate(product)
        if base_rate is None:
            frappe.throw(
                _("Não foi encontrada taxa para esta combinação de produto, idade, prazo e capital. "
                  "Verifique a Tabela de Taxas.")
            )

        # 4. Parse risk factor answers
        risk_answers = {}
        if self.risk_factors_json:
            try:
                risk_answers = json.loads(self.risk_factors_json)
            except (json.JSONDecodeError, ValueError):
                frappe.throw(_("O JSON de factores de risco está inválido. Recarregue o formulário."))

        # 5. Evaluate loadings from Risk Factor Template
        total_loading_pct = 0.0
        refusal_reasons = []
        breakdown_lines = [
            f"Taxa Base: {base_rate:.4f}%",
            f"Capital Segurado: MT {self.sum_insured:,.2f}",
            f"Prazo: {self.term_months} meses",
            "---",
        ]

        if product.risk_factor_template:
            template = frappe.get_doc("Risk Factor Template", product.risk_factor_template)
            for item in template.risk_factor_items:
                answer = risk_answers.get(item.fieldname)
                if answer is None:
                    continue

                # Check refusal condition
                if item.can_refuse and item.refusal_condition:
                    if _eval_condition(item.refusal_condition, answer):
                        refusal_reasons.append(
                            f"{item.factor_label}: condição de recusa atingida"
                        )

                # Apply loading logic
                if item.loading_logic:
                    try:
                        rules = json.loads(item.loading_logic)
                        for rule in rules:
                            if _eval_condition(rule.get("condition", ""), answer):
                                pct = frappe.utils.flt(rule.get("loading_pct", 0))
                                total_loading_pct += pct
                                breakdown_lines.append(
                                    f"  + {item.factor_label} ({answer}): +{pct:.1f}%"
                                )
                    except (json.JSONDecodeError, ValueError, TypeError):
                        frappe.log_error(
                            title=f"Erro ao processar loading_logic de {item.factor_label}",
                            message=frappe.get_traceback(),
                        )

        # 6. Evaluate product acceptance rules
        for rule in product.acceptance_rules:
            answer = risk_answers.get(rule.field_to_check)
            if answer is None:
                continue
            if _eval_condition(rule.condition, answer):
                if rule.action == "Recusar":
                    refusal_reasons.append(rule.rule_description or rule.field_to_check)
                elif rule.action == "Aplicar Carregamento" and rule.loading_pct:
                    total_loading_pct += rule.loading_pct
                    breakdown_lines.append(
                        f"  + Regra '{rule.rule_description}': +{rule.loading_pct:.1f}%"
                    )
                elif rule.action == "Marcar para Revisão":
                    if self.acceptance_status not in ("Recusado",):
                        self.acceptance_status = "Pendente de Revisão"

        # 7. Set acceptance status
        if refusal_reasons:
            self.acceptance_status = "Recusado"
            self.refusal_reason = "\n".join(refusal_reasons)
        elif total_loading_pct > 0:
            self.acceptance_status = "Aceite com Carregamento"
            self.refusal_reason = ""
        else:
            self.acceptance_status = "Aceite"
            self.refusal_reason = ""

        # 8. Calculate final rate and premium
        final_rate = base_rate * (1 + total_loading_pct / 100)
        premium = (self.sum_insured * final_rate / 100) * (self.term_months / 12)

        breakdown_lines.extend([
            "---",
            f"Total Carregamentos: +{total_loading_pct:.2f}%",
            f"Taxa Final: {final_rate:.4f}%",
            f"Prémio = {self.sum_insured:,.2f} × {final_rate:.4f}% × ({self.term_months}/12)",
            f"Prémio Total: MT {premium:,.2f}",
        ])

        # 9. Persist
        self.base_rate_pct = base_rate
        self.total_loading_pct = total_loading_pct
        self.final_rate_pct = final_rate
        self.premium_amount = premium
        self.premium_breakdown = "\n".join(breakdown_lines)
        self.save()

        frappe.msgprint(
            _("Prémio calculado: MT {0}").format(f"{premium:,.2f}"),
            title=_("Cálculo Concluído"),
            indicator="green" if self.acceptance_status != "Recusado" else "red",
        )

    def _get_base_rate(self, product):
        """Find a matching Premium Rate Table row for this quotation."""
        candidates = frappe.get_all(
            "Premium Rate Table",
            filters={"product": product.name, "is_active": 1},
            fields=[
                "base_rate_pct",
                "min_age", "max_age",
                "min_term_months", "max_term_months",
                "min_sum_insured", "max_sum_insured",
                "min_vehicle_year", "max_vehicle_year",
            ],
        )

        age = frappe.utils.cint(self.customer_age)
        term = frappe.utils.cint(self.term_months)
        capital = frappe.utils.flt(self.sum_insured)

        # vehicle_year from risk factors
        risk = {}
        if self.risk_factors_json:
            try:
                risk = json.loads(self.risk_factors_json)
            except (json.JSONDecodeError, ValueError):
                pass
        vehicle_year = frappe.utils.cint(risk.get("vehicle_year", 0))

        for row in candidates:
            if row.min_age and age and age < row.min_age:
                continue
            if row.max_age and age and age > row.max_age:
                continue
            if row.min_term_months and term and term < row.min_term_months:
                continue
            if row.max_term_months and term and term > row.max_term_months:
                continue
            if row.min_sum_insured and capital and capital < row.min_sum_insured:
                continue
            if row.max_sum_insured and capital and capital > row.max_sum_insured:
                continue
            if row.min_vehicle_year and vehicle_year and vehicle_year < row.min_vehicle_year:
                continue
            if row.max_vehicle_year and vehicle_year and vehicle_year > row.max_vehicle_year:
                continue
            return frappe.utils.flt(row.base_rate_pct)

        return None

    # ------------------------------------------------------------------
    # Button: Emitir Apólice
    # ------------------------------------------------------------------

    @frappe.whitelist()
    def create_policy(self):
        if self.acceptance_status == "Recusado":
            frappe.throw(
                _("Esta cotação foi RECUSADA e não pode gerar uma apólice.\nMotivo: {0}").format(
                    self.refusal_reason
                )
            )

        if self.linked_policy:
            frappe.throw(
                _("Esta cotação já gerou a apólice {0}.").format(self.linked_policy)
            )

        if not self.premium_amount:
            frappe.throw(_("Calcule o prémio antes de emitir a apólice."))

        product = frappe.get_doc("Insurance Product", self.insurance_product)

        policy = frappe.new_doc("Insurance Policy")
        policy.update({
            "quotation": self.name,
            "customer": self.customer,
            "customer_full_name": self.customer_full_name,
            "customer_bi": self.customer_bi,
            "customer_nuit": self.customer_nuit,
            "customer_dob": self.customer_dob,
            "customer_age": self.customer_age,
            "customer_gender": self.customer_gender,
            "customer_phone": self.customer_phone,
            "customer_address": self.customer_address,
            "insurance_product": self.insurance_product,
            "branch": self.branch,
            "sum_insured": self.sum_insured,
            "term_months": self.term_months,
            "coverage_start_date": self.coverage_start_date,
            "coverage_end_date": self.coverage_end_date,
            "premium_amount": self.premium_amount,
            "final_rate_pct": self.final_rate_pct,
            "premium_breakdown": self.premium_breakdown,
            "general_conditions": product.general_conditions,
            "special_conditions": product.special_conditions,
            "policy_status": "Pendente de Pagamento",
            "issued_by": frappe.session.user,
            "issued_date": frappe.utils.nowdate(),
            "risk_factors_summary": _build_risk_summary(
                self.risk_factors_json, product.risk_factor_template
            ),
        })

        # Copy coverages from product
        for cov in product.coverages:
            policy.append("coverages", {
                "coverage_type": cov.coverage_type,
                "sum_insured": cov.default_sum_insured,
                "is_active": 1,
            })

        policy.insert(ignore_permissions=False)
        policy.submit()

        # Update quotation
        self.db_set("status", "Aceite")
        self.db_set("linked_policy", policy.name)

        frappe.msgprint(
            _("Apólice {0} emitida com sucesso!").format(policy.name),
            title=_("Apólice Emitida"),
            indicator="green",
        )

        return policy.name


# ------------------------------------------------------------------
# Shared helpers (module-level)
# ------------------------------------------------------------------

def _eval_condition(condition: str, value) -> bool:
    """
    Safe condition evaluator. No eval() — regex-based parsing only.
    Handles: value == 'X', value != 'X', value > N, value < N,
              value >= N, value <= N, value == true/false
    """
    if not condition:
        return False

    condition = condition.strip()

    # Boolean check
    m = re.match(r"value\s*==\s*(true|false)", condition, re.IGNORECASE)
    if m:
        expected = m.group(1).lower() == "true"
        if isinstance(value, str):
            return value.lower() in ("1", "true", "yes")
        return bool(value) == expected

    # String equality / inequality
    m = re.match(r"value\s*(==|!=)\s*['\"](.+?)['\"]", condition)
    if m:
        op, lit = m.group(1), m.group(2)
        return (str(value) == lit) if op == "==" else (str(value) != lit)

    # Numeric comparisons
    m = re.match(r"value\s*(>=|<=|>|<|==)\s*(-?\d+(?:\.\d+)?)", condition)
    if m:
        op, lit = m.group(1), float(m.group(2))
        try:
            fv = float(value)
        except (ValueError, TypeError):
            return False
        return {
            ">": fv > lit, "<": fv < lit,
            ">=": fv >= lit, "<=": fv <= lit,
            "==": fv == lit,
        }[op]

    return False


def _build_risk_summary(risk_factors_json: str, template_name: str) -> str:
    if not risk_factors_json or not template_name:
        return ""
    try:
        answers = json.loads(risk_factors_json)
    except (json.JSONDecodeError, ValueError):
        return ""

    template = frappe.get_doc("Risk Factor Template", template_name)
    lines = []
    for item in template.risk_factor_items:
        val = answers.get(item.fieldname)
        if val is not None:
            lines.append(f"{item.factor_label}: {val}")
    return "\n".join(lines)
