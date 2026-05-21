// Hints shown in the "Novo Valor" field for each endorsement type
const NEW_VALUE_HINTS = {
    "Aumento de Capital":             "Novo capital segurado em MT (ex: 500000)",
    "Redução de Capital":             "Novo capital segurado em MT (ex: 300000)",
    "Extensão de Prazo":              "Nova data de fim de cobertura (AAAA-MM-DD)",
    "Adição de Cobertura":            "Nome exacto do Tipo de Cobertura a adicionar",
    "Substituição de Beneficiário":   "Nome do novo beneficiário",
    "Alteração de Dados do Segurado": "Novo valor do campo alterado",
    "Correcção de Dados":             "Valor correcto",
    "Cancelamento":                   "Deixe em branco ou indique motivo adicional",
};

const PREV_VALUE_HINTS = {
    "Aumento de Capital":             "Capital segurado actual em MT",
    "Redução de Capital":             "Capital segurado actual em MT",
    "Extensão de Prazo":              "Data de fim de cobertura actual (AAAA-MM-DD)",
    "Adição de Cobertura":            "—",
    "Substituição de Beneficiário":   "Nome do beneficiário anterior",
    "Alteração de Dados do Segurado": "Valor actual do campo",
    "Correcção de Dados":             "Valor incorrecto actual",
    "Cancelamento":                   "—",
};

const END_STEPS    = ["Rascunho", "Pendente de Aprovação", "Aprovado"];
const END_TERMINAL = ["Recusado"];

frappe.ui.form.on("Policy Endorsement", {

    refresh(frm) {
        _set_status_indicator(frm);
        _render_step_bar(frm, END_STEPS, END_TERMINAL, {});
        _add_navigation_buttons(frm);
        _add_workflow_buttons(frm);
        _update_field_hints(frm);
    },

    policy(frm) {
        if (!frm.doc.policy) return;
        frappe.db.get_value(
            "Insurance Policy",
            frm.doc.policy,
            ["customer", "customer_full_name", "policy_status",
             "branch", "sum_insured", "coverage_start_date", "coverage_end_date"],
            (r) => {
                if (!r) return;
                frm.set_value("customer", r.customer);
                frm.set_value("customer_full_name", r.customer_full_name);
                frm.set_value("branch", r.branch);
                frm.set_value("current_sum_insured", r.sum_insured);
                frm.set_value("coverage_start_date", r.coverage_start_date);
                frm.set_value("coverage_end_date", r.coverage_end_date);

                if (r.policy_status && !["Activa", "Pendente de Pagamento"].includes(r.policy_status)) {
                    frappe.show_alert({
                        message: __("Atenção: a apólice está com estado '{0}'. Endossos só são permitidos em apólices Activas.", [
                            r.policy_status,
                        ]),
                        indicator: "red",
                    });
                }
            }
        );
    },

    endorsement_type(frm) {
        _update_field_hints(frm);
        _show_cancellation_warning(frm);
    },
});

// ------------------------------------------------------------------
// Field hints — update description text based on endorsement type
// ------------------------------------------------------------------

function _update_field_hints(frm) {
    const etype = frm.doc.endorsement_type;
    if (!etype) return;

    const newHint  = NEW_VALUE_HINTS[etype]  || "";
    const prevHint = PREV_VALUE_HINTS[etype] || "";

    frm.set_df_property("new_value",      "description", newHint);
    frm.set_df_property("previous_value", "description", prevHint);

    // Pre-fill previous_value from current policy data when type implies it
    if (!frm.doc.previous_value) {
        if (["Aumento de Capital", "Redução de Capital"].includes(etype) && frm.doc.current_sum_insured) {
            frm.set_value("previous_value", String(frm.doc.current_sum_insured));
        } else if (etype === "Extensão de Prazo" && frm.doc.coverage_end_date) {
            frm.set_value("previous_value", frm.doc.coverage_end_date);
        }
    }
}

// ------------------------------------------------------------------
// Cancellation warning
// ------------------------------------------------------------------

function _show_cancellation_warning(frm) {
    if (frm.doc.endorsement_type !== "Cancelamento") return;
    frappe.show_alert({
        message: __("ATENÇÃO: o tipo 'Cancelamento' irá cancelar permanentemente a apólice quando aprovado. Esta acção não pode ser revertida."),
        indicator: "red",
    });
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
}

// ------------------------------------------------------------------
// Workflow action buttons — contextual per status
// ------------------------------------------------------------------

function _add_workflow_buttons(frm) {
    if (frm.is_new()) return;
    const status = frm.doc.status;

    // Rascunho → Pendente de Aprovação
    if (status === "Rascunho") {
        frm.add_custom_button(__("Submeter para Aprovação"), () => {
            frappe.confirm(
                __("Submeter este endosso para aprovação?"),
                () => frm.call("submit_endorsement").then(() => frm.reload_doc())
            );
        }).addClass("btn-primary");
    }

    // Pendente de Aprovação → Aprovado / Recusado
    if (status === "Pendente de Aprovação") {
        frm.add_custom_button(__("Aprovar Endosso"), () => {
            const isCancellation = frm.doc.endorsement_type === "Cancelamento";
            const msg = isCancellation
                ? __("⚠️ Confirma a aprovação deste endosso?\n\nATENÇÃO: a apólice {0} será CANCELADA imediatamente.", [frm.doc.policy])
                : __("Confirma a aprovação deste endosso?\nTipo: {0}\nNovo valor: {1}", [
                    frm.doc.endorsement_type,
                    frm.doc.new_value || "—",
                ]);

            frappe.confirm(msg, () => {
                frm.call("approve_endorsement").then(() => frm.reload_doc());
            });
        }, __("Acções")).addClass(frm.doc.endorsement_type !== "Cancelamento" ? "btn-primary" : "");

        frm.add_custom_button(__("Recusar Endosso"), () => {
            frappe.prompt(
                {
                    fieldname: "reason",
                    fieldtype: "Text",
                    label: __("Motivo de Recusa"),
                    reqd: 1,
                },
                (vals) => frm.call("reject_endorsement", { reason: vals.reason })
                           .then(() => frm.reload_doc()),
                __("Recusar Endosso")
            );
        }, __("Acções"));
    }
}

// ------------------------------------------------------------------
// Step-progress bar (shared implementation)
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
        "Rascunho":               "grey",
        "Pendente de Aprovação":  "orange",
        "Aprovado":               "green",
        "Recusado":               "red",
    }[frm.doc.status] || "grey";

    frm.dashboard.add_indicator(__(frm.doc.status || "Rascunho"), colour);
}
