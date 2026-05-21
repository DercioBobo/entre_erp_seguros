import base64
import io

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import nowdate, add_months, add_days, date_diff, getdate


class InsurancePolicy(Document):

    def validate(self):
        self._validate_beneficiary_percentages()
        self._calc_age()

    def before_submit(self):
        self.issued_by = frappe.session.user
        self.issued_date = nowdate()
        self._generate_qr_code()

    def on_submit(self):
        # Mark as pending payment — actual activation happens on Premium Payment submit
        if not self.policy_status:
            self.db_set("policy_status", "Pendente de Pagamento")

    # ------------------------------------------------------------------
    # Validation helpers
    # ------------------------------------------------------------------

    def _calc_age(self):
        if self.customer_dob:
            today = getdate(nowdate())
            dob = getdate(self.customer_dob)
            self.customer_age = (
                today.year - dob.year
                - ((today.month, today.day) < (dob.month, dob.day))
            )

    def _validate_beneficiary_percentages(self):
        if not self.beneficiaries:
            return
        total = sum(frappe.utils.flt(b.percentage) for b in self.beneficiaries)
        if total and abs(total - 100) > 0.01:
            frappe.throw(
                _("A soma das participações dos beneficiários deve ser 100%. Actual: {0:.2f}%").format(total)
            )

    # ------------------------------------------------------------------
    # QR Code generation
    # ------------------------------------------------------------------

    def _generate_qr_code(self):
        try:
            import qrcode
            from PIL import Image

            site_url = frappe.utils.get_url()
            verify_url = f"{site_url}/verify?p={self.name}"
            self.qr_code_url = verify_url

            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_M,
                box_size=8,
                border=4,
            )
            qr.add_data(verify_url)
            qr.make(fit=True)

            img = qr.make_image(fill_color="#212121", back_color="white")

            buffer = io.BytesIO()
            img.save(buffer, format="PNG")
            buffer.seek(0)

            file_name = f"qr_{self.name}.png"
            file_doc = frappe.get_doc({
                "doctype": "File",
                "file_name": file_name,
                "attached_to_doctype": self.doctype,
                "attached_to_name": self.name,
                "attached_to_field": "qr_code",
                "content": buffer.read(),
                "is_private": 0,
            })
            file_doc.save(ignore_permissions=True)
            self.db_set("qr_code", file_doc.file_url)

        except ImportError:
            frappe.log_error(
                title="QR Code: biblioteca não instalada",
                message="Instale qrcode[pil] e Pillow no ambiente Frappe.",
            )
        except Exception:
            frappe.log_error(
                title=f"Erro ao gerar QR Code para {self.name}",
                message=frappe.get_traceback(),
            )

    # ------------------------------------------------------------------
    # Policy activation (called by Premium Payment on_submit)
    # ------------------------------------------------------------------

    def activate(self, payment_reference: str):
        self.db_set("policy_status", "Activa")
        self.db_set("activation_date", nowdate())
        self.db_set("payment_reference", payment_reference)

    # ------------------------------------------------------------------
    # Policy renewal
    # ------------------------------------------------------------------

    @frappe.whitelist()
    def renew_policy(self):
        if self.policy_status not in ("Expirada", "Activa"):
            frappe.throw(_("Só é possível renovar apólices Activas ou Expiradas."))

        if self.renewed_by:
            frappe.throw(
                _("Esta apólice já foi renovada. Apólice de renovação: {0}.").format(self.renewed_by)
            )

        if not self.coverage_end_date:
            frappe.throw(_("A apólice não tem data de fim de cobertura definida."))

        # New coverage period: day after old end → + term_months
        new_start = add_days(getdate(self.coverage_end_date), 1)
        new_end   = add_months(new_start, self.term_months or 12)

        # Recalculate age at new start date
        new_age = self.customer_age
        if self.customer_dob:
            new_age = int(date_diff(new_start, getdate(self.customer_dob)) / 365.25)

        # Premium: keep final_rate_pct (includes underwriting loadings already agreed)
        new_premium = self.premium_amount
        if self.final_rate_pct and self.sum_insured and self.term_months:
            new_premium = round(
                self.sum_insured * (self.final_rate_pct / 100) * (self.term_months / 12), 2
            )

        new_policy = frappe.new_doc("Insurance Policy")
        new_policy.update({
            # Insured
            "customer":           self.customer,
            "customer_full_name": self.customer_full_name,
            "customer_dob":       self.customer_dob,
            "customer_age":       new_age,
            "customer_gender":    self.customer_gender,
            "customer_bi":        self.customer_bi,
            "customer_nuit":      self.customer_nuit,
            "customer_phone":     self.customer_phone,
            "customer_address":   self.customer_address,
            # Product
            "insurance_product":  self.insurance_product,
            "branch":             self.branch,
            "sum_insured":        self.sum_insured,
            "premium_amount":     new_premium,
            "final_rate_pct":     self.final_rate_pct,
            # Period
            "term_months":          self.term_months,
            "coverage_start_date":  new_start,
            "coverage_end_date":    new_end,
            # Conditions & notes
            "general_conditions":   self.general_conditions,
            "special_conditions":   self.special_conditions,
            "risk_factors_summary": self.risk_factors_summary,
            "premium_breakdown": (
                f"Renovação da apólice {self.name}.\n"
                f"Taxa aplicada: {self.final_rate_pct}%  |  "
                f"Idade do segurado: {new_age} anos."
            ),
            # Status & audit
            "policy_status": "Pendente de Pagamento",
            "renewal_of":    self.name,
        })

        for b in (self.beneficiaries or []):
            new_policy.append("beneficiaries", {
                "beneficiary_name": b.beneficiary_name,
                "relationship":     b.relationship,
                "percentage":       b.percentage,
                "bi_number":        b.bi_number,
                "phone":            b.phone,
            })

        for c in (self.coverages or []):
            new_policy.append("coverages", {
                "coverage_type": c.coverage_type,
                "sum_insured":   c.sum_insured,
                "is_active":     c.is_active,
            })

        new_policy.insert(ignore_permissions=True)
        new_policy.submit()  # triggers before_submit: issued_by, issued_date, QR code

        # Lock old policy against further renewals
        self.db_set("renewed_by", new_policy.name)

        return new_policy.name

    # ------------------------------------------------------------------
    # Policy cancellation
    # ------------------------------------------------------------------

    @frappe.whitelist()
    def cancel_policy(self, reason):
        if self.policy_status not in ("Activa", "Pendente de Pagamento"):
            frappe.throw(_("Só é possível cancelar apólices Activas ou Pendentes de Pagamento."))
        if not reason:
            frappe.throw(_("Indique o motivo de cancelamento."))
        self.db_set("policy_status", "Cancelada")
        self.db_set("cancellation_date", nowdate())
        self.db_set("cancellation_reason", reason)
