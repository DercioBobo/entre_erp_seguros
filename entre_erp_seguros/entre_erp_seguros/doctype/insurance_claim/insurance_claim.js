const CLAIM_STEPS    = ["Rascunho", "Submetido", "Em Análise", "Aprovado", "Em Liquidação", "Liquidado"];
const CLAIM_TERMINAL = ["Rejeitado", "Cancelado"];
const CLAIM_ALIAS    = { "Pendente Documentação": "Em Análise" };

frappe.ui.form.on("Insurance Claim", {

    refresh(frm) {
        _set_status_indicator(frm);
        _render_step_bar(frm, CLAIM_STEPS, CLAIM_TERMINAL, CLAIM_ALIAS);
        _add_navigation_buttons(frm);
        _add_workflow_buttons(frm);
    },

    policy(frm) {
        if (!frm.doc.policy) return;
        frappe.db.get_value(
            "Insurance Policy",
            frm.doc.policy,
            ["customer", "customer_full_name", "policy_status", "insurance_product",
             "branch", "sum_insured", "coverage_start_date", "coverage_end_date",
             "beneficiaries"],
            (r) => {
                if (!r) return;
                frm.set_value("customer", r.customer);
                frm.set_value("customer_full_name", r.customer_full_name);
                frm.set_value("insurance_product", r.insurance_product);
                frm.set_value("branch", r.branch);
                frm.set_value("sum_insured", r.sum_insured);
                frm.set_value("coverage_start_date", r.coverage_start_date);
                frm.set_value("coverage_end_date", r.coverage_end_date);

                if (r.policy_status && r.policy_status !== "Activa") {
                    frappe.show_alert({
                        message: __("Atenção: a apólice {0} não está Activa (estado: {1}).", [
                            frm.doc.policy, r.policy_status
                        ]),
                        indicator: "red",
                    });
                }
            }
        );
    },

    incident_date(frm) {
        if (!frm.doc.incident_date) return;
        const today = frappe.datetime.get_today();
        if (frm.doc.incident_date > today) {
            frappe.show_alert({
                message: __("A data do sinistro está no futuro."),
                indicator: "orange",
            });
        }
        if (frm.doc.coverage_start_date && frm.doc.incident_date < frm.doc.coverage_start_date) {
            frappe.show_alert({
                message: __("A data do sinistro é anterior ao início de cobertura da apólice."),
                indicator: "red",
            });
        }
        if (frm.doc.coverage_end_date && frm.doc.incident_date > frm.doc.coverage_end_date) {
            frappe.show_alert({
                message: __("A data do sinistro é posterior ao fim de cobertura da apólice."),
                indicator: "red",
            });
        }
    },

    approved_amount(frm) { _calc_net_payable(frm); },
    deductible_amount(frm) { _calc_net_payable(frm); },

    payment_method(frm) { _toggle_payment_fields(frm); },
});

// ------------------------------------------------------------------
// Net payable calculation
// ------------------------------------------------------------------

function _calc_net_payable(frm) {
    const approved = frm.doc.approved_amount || 0;
    const deductible = frm.doc.deductible_amount || 0;
    frm.set_value("net_payable_amount", Math.max(0, approved - deductible));

    if (frm.doc.sum_insured && approved > frm.doc.sum_insured) {
        frappe.show_alert({
            message: __("O valor aprovado excede o capital segurado ({0} MT).", [
                format_currency(frm.doc.sum_insured, "MT", 2),
            ]),
            indicator: "red",
        });
    }
}

// ------------------------------------------------------------------
// Show/hide payment fields based on method
// ------------------------------------------------------------------

function _toggle_payment_fields(frm) {
    const method = frm.doc.payment_method;
    const isMobile = ["M-Pesa", "e-Mola"].includes(method);
    const isBank   = ["Transferência Bancária", "Cheque"].includes(method);
    frm.toggle_display("mobile_money_number", isMobile);
    frm.toggle_display("bank_name",    isBank);
    frm.toggle_display("bank_account", isBank);
}

// ------------------------------------------------------------------
// Navigation buttons
// ------------------------------------------------------------------

function _add_navigation_buttons(frm) {
    if (frm.doc.policy) {
        frm.add_custom_button(__("Ver Apólice"), () => {
            frappe.set_route("Form", "Insurance Policy", frm.doc.policy);
        }, __("Navegar"));
    }
    if (frm.doc.settlement_reference) {
        frm.add_custom_button(__("Ver Recibo"), () => {
            frappe.set_route("Form", "Claim Settlement Receipt", frm.doc.settlement_reference);
        }, __("Navegar"));
    }
    if (frm.doc.settlement_entry) {
        frm.add_custom_button(__("Ver Pagamento"), () => {
            frappe.set_route("Form", "Payment Entry", frm.doc.settlement_entry);
        }, __("Navegar"));
    }
}

// ------------------------------------------------------------------
// Workflow action buttons — contextual per status
// ------------------------------------------------------------------

function _add_workflow_buttons(frm) {
    if (frm.is_new()) return;
    const status = frm.doc.status;

    // Rascunho → Submetido
    if (status === "Rascunho") {
        frm.add_custom_button(__("Submeter Participação"), () => {
            frappe.confirm(
                __("Confirma a submissão formal desta participação de sinistro?"),
                () => frm.call("submit_claim").then(() => frm.reload_doc())
            );
        }).addClass("btn-primary");
    }

    // Submetido | Pendente → Em Análise
    if (["Submetido", "Pendente Documentação"].includes(status)) {
        frm.add_custom_button(__("Iniciar Análise"), () => {
            frm.call("start_analysis").then(() => frm.reload_doc());
        }).addClass("btn-primary");
    }

    // Em Análise actions
    if (status === "Em Análise") {
        frm.add_custom_button(__("Solicitar Documentos"), () => {
            frappe.prompt(
                {
                    fieldname: "note",
                    fieldtype: "Text",
                    label: __("Liste os documentos em falta"),
                    reqd: 1,
                },
                (vals) => frm.call("request_documents", { note: vals.note })
                           .then(() => frm.reload_doc()),
                __("Solicitar Documentos em Falta")
            );
        }, __("Acções"));
    }

    // Em Análise | Pendente → Aprovar / Rejeitar
    if (["Em Análise", "Pendente Documentação"].includes(status)) {
        frm.add_custom_button(__("Aprovar Sinistro"), () => {
            if (!frm.doc.approved_amount || frm.doc.approved_amount <= 0) {
                frappe.msgprint(__("Preencha o valor aprovado antes de aprovar."));
                return;
            }
            const net = (frm.doc.approved_amount || 0) - (frm.doc.deductible_amount || 0);
            frappe.confirm(
                __("Aprovar sinistro?\nValor aprovado: {0} MT  |  Franquia: {1} MT  |  Líquido: {2} MT", [
                    format_currency(frm.doc.approved_amount, "", 2),
                    format_currency(frm.doc.deductible_amount || 0, "", 2),
                    format_currency(Math.max(0, net), "", 2),
                ]),
                () => frm.call("approve_claim").then(() => frm.reload_doc())
            );
        }, __("Acções"));

        frm.add_custom_button(__("Rejeitar Sinistro"), () => {
            frappe.prompt(
                {
                    fieldname: "reason",
                    fieldtype: "Text",
                    label: __("Motivo de Rejeição"),
                    reqd: 1,
                },
                (vals) => frm.call("reject_claim", { reason: vals.reason })
                           .then(() => frm.reload_doc()),
                __("Rejeitar Sinistro")
            );
        }, __("Acções"));
    }

    // Aprovado → Em Liquidação
    if (status === "Aprovado") {
        frm.add_custom_button(__("Iniciar Liquidação"), () => {
            frappe.confirm(
                __("Iniciar processo de liquidação de {0} MT ao beneficiário?", [
                    format_currency(frm.doc.net_payable_amount || 0, "MT", 2),
                ]),
                () => frm.call("start_settlement").then(() => frm.reload_doc())
            );
        }).addClass("btn-primary");
    }

    // Em Liquidação → Liquidado (confirm payment)
    if (status === "Em Liquidação") {
        if (!frm.doc.payment_method || !frm.doc.beneficiary_name) {
            frappe.show_alert({
                message: __("Complete os dados do beneficiário e o método de pagamento antes de confirmar a liquidação."),
                indicator: "orange",
            });
        }
        frm.add_custom_button(__("Confirmar Liquidação"), () => {
            if (!frm.doc.payment_method) {
                frappe.msgprint(__("Seleccione o método de pagamento.")); return;
            }
            if (!frm.doc.beneficiary_name) {
                frappe.msgprint(__("Preencha o nome do beneficiário.")); return;
            }
            frappe.confirm(
                __("Confirmar pagamento de {0} MT a {1} via {2}?", [
                    format_currency(frm.doc.net_payable_amount || 0, "MT", 2),
                    frm.doc.beneficiary_name,
                    frm.doc.payment_method,
                ]),
                () => frm.call("confirm_settlement").then(() => frm.reload_doc())
            );
        }).addClass("btn-primary");
    }
}

// ------------------------------------------------------------------
// Step-progress bar
// ------------------------------------------------------------------

function _render_step_bar(frm, steps, terminalList, aliasMap) {
    const ATTR = 'data-ins-sbar';
    frm.dashboard.$wrapper.find(`[${ATTR}]`).remove();
    const raw = frm.doc.status || "";
    if (!raw) return;

    const isTerminal = (terminalList || []).includes(raw);
    const mapped     = (aliasMap || {})[raw] || raw;
    const currentIdx = isTerminal ? steps.length : steps.indexOf(mapped);

    const stepsHtml = steps.map((label, i) => {
        const done   = i < currentIdx;
        const active = !isTerminal && i === currentIdx;
        const conn   = i > 0
            ? `<div class="sbar-conn ${done || active ? 'sbar-conn-hi' : ''}"></div>` : "";
        return `${conn}<div class="sbar-step">
            <div class="sbar-o ${done ? 'sbar-done' : active ? 'sbar-now' : ''}">${done ? "&#10003;" : i + 1}</div>
            <div class="sbar-lbl ${done || active ? 'sbar-lbl-hi' : ''}">${__(label)}</div>
        </div>`;
    }).join("");

    const TERM_CLR = { "Rejeitado": "#c62828", "Cancelado": "#e65100", "Recusado": "#c62828" };
    const tc = TERM_CLR[raw] || "#757575";
    const termHtml = isTerminal ? `
        <div class="sbar-conn"></div>
        <div class="sbar-step">
            <div class="sbar-o" style="background:${tc}18;color:${tc};border:2px solid ${tc}55;font-size:9px;">&#x2715;</div>
            <div class="sbar-lbl sbar-lbl-hi" style="color:${tc};">${__(raw)}</div>
        </div>` : "";

    _inject_sbar_css();
    frm.dashboard.$wrapper.prepend($(`<div ${ATTR}="1" style="
        display:flex;align-items:center;justify-content:center;flex-wrap:wrap;
        padding:10px 16px 6px;margin-bottom:4px;
        background:#fafafa;border-bottom:1px solid #ebebeb;
    ">${stepsHtml}${termHtml}</div>`));
}

function _inject_sbar_css() {
    if (document.getElementById('_ins_sbar_css')) return;
    $(`<style id="_ins_sbar_css">
        .sbar-step{display:flex;flex-direction:column;align-items:center;min-width:58px}
        .sbar-o{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;
            justify-content:center;font-size:11px;font-weight:700;
            background:#eee;color:#bbb;border:2px solid #ddd}
        .sbar-done{background:#43a047;color:#fff;border-color:#43a047}
        .sbar-now{background:#F57C00;color:#fff;border-color:#F57C00}
        .sbar-lbl{font-size:8px;color:#bbb;margin-top:3px;text-align:center;max-width:68px;line-height:1.3}
        .sbar-lbl-hi{color:#424242;font-weight:600}
        .sbar-conn{flex:1;height:2px;background:#e0e0e0;min-width:16px;max-width:44px;
            margin-bottom:16px;border-radius:1px}
        .sbar-conn-hi{background:#43a047}
    </style>`).appendTo('head');
}

// ------------------------------------------------------------------
// Status indicator
// ------------------------------------------------------------------

function _set_status_indicator(frm) {
    const colour = {
        "Rascunho":              "grey",
        "Submetido":             "blue",
        "Em Análise":            "orange",
        "Pendente Documentação": "yellow",
        "Aprovado":              "green",
        "Rejeitado":             "red",
        "Em Liquidação":         "purple",
        "Liquidado":             "green",
        "Cancelado":             "grey",
    }[frm.doc.status] || "grey";

    frm.dashboard.add_indicator(__(frm.doc.status || "Rascunho"), colour);
}
