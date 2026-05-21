import frappe
import json
from frappe import _
from frappe.model.document import Document


class RiskFactorItem(Document):
    def validate(self):
        if self.field_type == "Select" and not self.select_options:
            frappe.throw(
                _("O campo '{0}' é do tipo Selecção mas não tem opções definidas.").format(
                    self.factor_label
                )
            )

        if self.fieldname:
            self.fieldname = self.fieldname.lower().strip().replace(" ", "_")

        if self.loading_logic:
            self._validate_loading_logic_json()

        if self.can_refuse and not self.refusal_condition:
            frappe.throw(
                _("O factor '{0}' tem 'Pode Recusar' marcado mas sem condição de recusa definida.").format(
                    self.factor_label
                )
            )

    def _validate_loading_logic_json(self):
        try:
            rules = json.loads(self.loading_logic)
            if not isinstance(rules, list):
                frappe.throw(
                    _("A lógica de carregamento do factor '{0}' deve ser uma lista JSON.").format(
                        self.factor_label
                    )
                )
        except (json.JSONDecodeError, ValueError):
            frappe.throw(
                _("A lógica de carregamento do factor '{0}' contém JSON inválido.").format(
                    self.factor_label
                )
            )
