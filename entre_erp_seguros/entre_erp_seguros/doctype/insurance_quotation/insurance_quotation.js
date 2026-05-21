frappe.ui.form.on("Insurance Quotation", {

    // ------------------------------------------------------------------
    // Form setup — buttons + initial state
    // ------------------------------------------------------------------

    refresh(frm) {
        frm.trigger("render_risk_factors");

        if (!frm.is_new()) {
            frm.add_custom_button(__("Calcular Prémio"), () => {
                frm.trigger("do_calculate_premium");
            }, __("Acções")).addClass("btn-primary");

            if (
                frm.doc.acceptance_status !== "Recusado" &&
                frm.doc.premium_amount > 0 &&
                !frm.doc.linked_policy
            ) {
                frm.add_custom_button(__("Emitir Apólice"), () => {
                    frm.trigger("do_create_policy");
                }, __("Acções")).addClass("btn-success");
            }
        }

        // Colour-code acceptance status indicator
        const colour = {
            "Aceite": "green",
            "Aceite com Carregamento": "orange",
            "Pendente de Revisão": "yellow",
            "Recusado": "red",
        }[frm.doc.acceptance_status] || "grey";

        if (frm.doc.acceptance_status) {
            frm.dashboard.add_indicator(frm.doc.acceptance_status, colour);
        }
    },

    // ------------------------------------------------------------------
    // Button handlers
    // ------------------------------------------------------------------

    do_calculate_premium(frm) {
        frappe.confirm(
            __("Calcular o prémio para {0} com capital MT {1}?", [
                frm.doc.customer_full_name || frm.doc.customer,
                frappe.format(frm.doc.sum_insured, { fieldtype: "Currency" }),
            ]),
            () => {
                frm.call({
                    method: "calculate_premium",
                    doc: frm.doc,
                    freeze: true,
                    freeze_message: __("A calcular prémio…"),
                    callback(r) {
                        if (!r.exc) frm.reload_doc();
                    },
                });
            }
        );
    },

    do_create_policy(frm) {
        if (!frm.doc.premium_amount) {
            frappe.show_alert({
                message: __("Calcule o prémio antes de emitir a apólice."),
                indicator: "orange",
            });
            return;
        }
        if (frm.is_dirty()) {
            frappe.show_alert({
                message: __("O formulário tem alterações não gravadas. Grave e recalcule o prémio antes de emitir."),
                indicator: "orange",
            });
            return;
        }
        frappe.confirm(
            __("Emitir apólice para {0}? O prémio total é MT {1}.", [
                frm.doc.customer_full_name || frm.doc.customer,
                frappe.format(frm.doc.premium_amount, { fieldtype: "Currency" }),
            ]),
            () => {
                frm.call({
                    method: "create_policy",
                    doc: frm.doc,
                    freeze: true,
                    freeze_message: __("A emitir apólice…"),
                    callback(r) {
                        if (!r.exc && r.message) {
                            frappe.show_alert({
                                message: __("Apólice {0} emitida!", [r.message]),
                                indicator: "green",
                            });
                            frm.reload_doc();
                        }
                    },
                });
            }
        );
    },

    // ------------------------------------------------------------------
    // Customer change — pull insurance custom fields
    // ------------------------------------------------------------------

    customer(frm) {
        if (!frm.doc.customer) return;

        frappe.db.get_value(
            "Customer",
            frm.doc.customer,
            ["customer_bi", "customer_nuit", "customer_dob", "customer_gender", "customer_phone_ins", "customer_address_ins"],
            (r) => {
                if (!r) return;
                frm.set_value("customer_bi",      r.customer_bi      || "");
                frm.set_value("customer_nuit",     r.customer_nuit    || "");
                frm.set_value("customer_gender",   r.customer_gender  || "");
                frm.set_value("customer_phone",    r.customer_phone_ins || "");
                frm.set_value("customer_address",  r.customer_address_ins || "");
                if (r.customer_dob) {
                    frm.set_value("customer_dob", r.customer_dob);
                }
            }
        );
    },

    // ------------------------------------------------------------------
    // DOB → age (real-time, server also recalculates on save)
    // ------------------------------------------------------------------

    customer_dob(frm) {
        if (!frm.doc.customer_dob) return;
        const dob  = moment(frm.doc.customer_dob);
        const today = moment();
        frm.set_value("customer_age", today.diff(dob, "years"));
    },

    // ------------------------------------------------------------------
    // Start date / term → end date (real-time)
    // ------------------------------------------------------------------

    coverage_start_date(frm) { frm.trigger("recalc_end_date"); },
    term_months(frm)          { frm.trigger("recalc_end_date"); },

    recalc_end_date(frm) {
        if (frm.doc.coverage_start_date && frm.doc.term_months) {
            const end = frappe.datetime.add_months(
                frm.doc.coverage_start_date,
                frm.doc.term_months
            );
            frm.set_value("coverage_end_date", end);
        }
    },

    // ------------------------------------------------------------------
    // Product change → fetch branch + render risk factors
    // ------------------------------------------------------------------

    insurance_product(frm) {
        if (!frm.doc.insurance_product) {
            frm.set_value("branch", "");
            _clear_risk_factors(frm);
            return;
        }

        frappe.db.get_value(
            "Insurance Product",
            frm.doc.insurance_product,
            ["branch", "risk_factor_template"],
            (r) => {
                frm.set_value("branch", r.branch || "");
                frm.trigger("render_risk_factors");
            }
        );
    },

    // ------------------------------------------------------------------
    // Dynamic risk factor form renderer
    // ------------------------------------------------------------------

    render_risk_factors(frm) {
        const container = frm.fields_dict.risk_factors_html.$wrapper;

        if (!frm.doc.insurance_product) {
            container.html(
                `<div class="text-muted p-3">
                    <i class="fa fa-info-circle"></i>
                    Seleccione um produto para carregar os factores de risco.
                </div>`
            );
            return;
        }

        frappe.db.get_value(
            "Insurance Product",
            frm.doc.insurance_product,
            "risk_factor_template",
            (r) => {
                if (!r || !r.risk_factor_template) {
                    container.html(
                        `<div class="text-muted p-3">
                            <i class="fa fa-check-circle text-success"></i>
                            Este produto não requer factores de risco adicionais.
                        </div>`
                    );
                    return;
                }

                frappe.call({
                    method: "frappe.client.get",
                    args: {
                        doctype: "Risk Factor Template",
                        name: r.risk_factor_template,
                    },
                    callback(res) {
                        if (!res.message) return;
                        _render_factor_form(frm, container, res.message.risk_factor_items);
                    },
                });
            }
        );
    },
});

// ------------------------------------------------------------------
// Private helpers
// ------------------------------------------------------------------

function _clear_risk_factors(frm) {
    const container = frm.fields_dict.risk_factors_html.$wrapper;
    container.html(
        `<div class="text-muted p-3">Seleccione um produto para carregar os factores de risco.</div>`
    );
    frm.set_value("risk_factors_json", "{}");
}

function _render_factor_form(frm, container, factors) {
    // Parse existing answers — surface parse errors visibly instead of silently losing data
    let answers = {};
    let parseError = false;
    const rawJson = frm.doc.risk_factors_json || "";
    try {
        if (rawJson) {
            answers = JSON.parse(rawJson);
        }
    } catch (e) {
        parseError = true;
        console.warn("[EntreERP] risk_factors_json inválido — dados não carregados:", e.message, rawJson);
    }

    const warningHtml = parseError ? `
        <div style="
            background: #fff8e1; border: 1px solid #ffe082; border-radius: 5px;
            padding: 8px 12px; margin-bottom: 12px; font-size: 8pt; color: #6d4c00;
        ">
            <strong>⚠ Atenção:</strong> Os dados de factores de risco guardados anteriormente
            estão corrompidos e não puderam ser carregados. Os campos foram reiniciados —
            preencha novamente e recalcule o prémio.
            <br><code style="font-size:7pt; opacity:.7; word-break:break-all;">${
                rawJson.length > 200 ? rawJson.substring(0, 200) + "…" : rawJson
            }</code>
        </div>` : "";

    const rows = factors.map(f => _build_field_html(f, answers[f.fieldname])).join("");

    container.html(`
        <div class="risk-factors-form" style="
            background: #fff;
            border: 1px solid #d1d8dd;
            border-radius: 8px;
            padding: 16px 20px;
            margin-top: 8px;
        ">
            ${warningHtml}
            <div style="
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 1px;
                text-transform: uppercase;
                color: #8d99a6;
                margin-bottom: 14px;
            ">Factores de Risco</div>
            <div class="row">${rows}</div>
        </div>
    `);

    // Attach change listeners to serialize answers
    container.find("[data-fieldname]").on("change input", function () {
        _serialize_answers(frm, container, factors);
    });

    // Pre-serialize in case existing answers are loaded
    _serialize_answers(frm, container, factors);
}

function _build_field_html(factor, current_value) {
    const val  = current_value !== undefined ? current_value : "";
    const reqd = factor.is_mandatory ? "required" : "";
    const label = `
        <label style="font-size:12px; font-weight:600; color:#495057; margin-bottom:4px; display:block;">
            ${factor.factor_label}
            ${factor.is_mandatory ? '<span class="text-danger"> *</span>' : ""}
            ${factor.can_refuse
                ? '<span style="font-size:10px; color:#e74c3c; margin-left:4px;">(pode recusar)</span>'
                : ""}
        </label>`;

    let input = "";

    switch (factor.field_type) {
        case "Check":
            input = `
                <div class="form-check" style="margin-top:6px;">
                    <input type="checkbox" class="form-check-input"
                        data-fieldname="${factor.fieldname}"
                        ${val === true || val === "1" || val === 1 ? "checked" : ""}
                        style="width:18px; height:18px; cursor:pointer;">
                </div>`;
            break;

        case "Select": {
            const opts = (factor.select_options || "").split("\n")
                .filter(o => o.trim())
                .map(o => `<option value="${o.trim()}" ${val === o.trim() ? "selected" : ""}>${o.trim()}</option>`)
                .join("");
            input = `
                <select class="form-control form-control-sm"
                    data-fieldname="${factor.fieldname}" ${reqd}
                    style="border-radius:5px;">
                    <option value="">-- Seleccionar --</option>
                    ${opts}
                </select>`;
            break;
        }

        case "Int":
            input = `<input type="number" step="1" class="form-control form-control-sm"
                data-fieldname="${factor.fieldname}"
                value="${val}" ${reqd} style="border-radius:5px;">`;
            break;

        case "Float":
            input = `<input type="number" step="0.01" class="form-control form-control-sm"
                data-fieldname="${factor.fieldname}"
                value="${val}" ${reqd} style="border-radius:5px;">`;
            break;

        case "Date":
            input = `<input type="date" class="form-control form-control-sm"
                data-fieldname="${factor.fieldname}"
                value="${val}" ${reqd} style="border-radius:5px;">`;
            break;

        default: // Data
            input = `<input type="text" class="form-control form-control-sm"
                data-fieldname="${factor.fieldname}"
                value="${val}" ${reqd} style="border-radius:5px;">`;
    }

    return `
        <div class="col-sm-6" style="margin-bottom:14px;">
            ${label}
            ${input}
        </div>`;
}

function _serialize_answers(frm, container, factors) {
    const answers = {};
    factors.forEach(f => {
        const el = container.find(`[data-fieldname="${f.fieldname}"]`);
        if (!el.length) return;

        if (f.field_type === "Check") {
            answers[f.fieldname] = el.prop("checked");
        } else if (f.field_type === "Int") {
            const v = el.val();
            answers[f.fieldname] = v !== "" ? parseInt(v, 10) : null;
        } else if (f.field_type === "Float") {
            const v = el.val();
            answers[f.fieldname] = v !== "" ? parseFloat(v) : null;
        } else {
            answers[f.fieldname] = el.val() || null;
        }
    });

    const newJson = JSON.stringify(answers, null, 2);
    if (frm.doc.risk_factors_json === newJson) return;
    frm.doc.risk_factors_json = newJson;
    frm.dirty();
}
