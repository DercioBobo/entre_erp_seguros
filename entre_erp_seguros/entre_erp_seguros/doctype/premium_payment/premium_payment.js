const PAY_STEPS    = ["Rascunho", "Submetido"];
const PAY_TERMINAL = ["Cancelado"];

frappe.ui.form.on("Premium Payment", {

    // ----------------------------------------------------------------
    // onload — reliably set amount from policy for new documents.
    // frappe.new_doc() pre-fill for non-fetch_from fields is unreliable
    // when fetch_from chains fire after route_options are applied.
    // ----------------------------------------------------------------

    onload(frm) {
        if (!frm.is_new() || !frm.doc.policy) return;
        frappe.db.get_value(
            "Insurance Policy",
            frm.doc.policy,
            "premium_amount",
            (r) => {
                if (r && r.premium_amount && !frm.doc.amount) {
                    frm.set_value("amount", r.premium_amount);
                }
            }
        );
    },

    refresh(frm) {
        _set_status_indicator(frm);
        _render_step_bar(frm, PAY_STEPS, PAY_TERMINAL, {});

        if (frm.doc.policy) {
            frm.add_custom_button(__("Ver Apólice"), () => {
                frappe.set_route("Form", "Insurance Policy", frm.doc.policy);
            }, __("Navegar"));
        }
        if (frm.doc.sales_invoice) {
            frm.add_custom_button(__("Ver Factura"), () => {
                frappe.set_route("Form", "Sales Invoice", frm.doc.sales_invoice);
            }, __("Navegar"));
        }
        if (frm.doc.payment_entry) {
            frm.add_custom_button(__("Ver Lançamento"), () => {
                frappe.set_route("Form", "Payment Entry", frm.doc.payment_entry);
            }, __("Navegar"));
        }
    },
});

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
        "Rascunho":  "grey",
        "Submetido": "green",
        "Cancelado": "red",
    }[frm.doc.status] || "grey";
    frm.dashboard.add_indicator(__(frm.doc.status || "Rascunho"), colour);
}
