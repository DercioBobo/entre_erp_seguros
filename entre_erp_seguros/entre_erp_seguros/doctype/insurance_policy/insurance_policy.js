frappe.ui.form.on("Insurance Policy", {

    refresh(frm) {
        _set_status_indicator(frm);

        // Read-only once submitted
        if (frm.doc.docstatus === 1) {
            frm.disable_save();
        }

        // Navigation — source quotation
        if (frm.doc.quotation) {
            frm.add_custom_button(__("Ver Cotação"), () => {
                frappe.set_route("Form", "Insurance Quotation", frm.doc.quotation);
            }, __("Navegar"));
        }

        // Navigation — renewal trail
        if (frm.doc.renewal_of) {
            frm.add_custom_button(__("Apólice Original"), () => {
                frappe.set_route("Form", "Insurance Policy", frm.doc.renewal_of);
            }, __("Navegar"));
        }
        if (frm.doc.renewed_by) {
            frm.add_custom_button(__("Apólice Renovada"), () => {
                frappe.set_route("Form", "Insurance Policy", frm.doc.renewed_by);
            }, __("Navegar"));
        }

        // Navigation — related lists
        frm.add_custom_button(__("Pagamentos"), () => {
            frappe.set_route("List", "Premium Payment", { policy: frm.doc.name });
        }, __("Navegar"));
        frm.add_custom_button(__("Sinistros"), () => {
            frappe.set_route("List", "Insurance Claim", { policy: frm.doc.name });
        }, __("Navegar"));
        frm.add_custom_button(__("Endossos"), () => {
            frappe.set_route("List", "Policy Endorsement", { policy: frm.doc.name });
        }, __("Navegar"));

        if (frm.doc.docstatus === 1) {
            // Cancellation — available on active or pending-payment policies
            if (["Activa", "Pendente de Pagamento"].includes(frm.doc.policy_status)) {
                frm.add_custom_button(__("Cancelar Apólice"), () => {
                    frappe.prompt(
                        {
                            fieldname: "reason",
                            fieldtype: "Text",
                            label: __("Motivo de Cancelamento"),
                            reqd: 1,
                        },
                        (vals) => {
                            frappe.confirm(
                                __("⚠️ Cancelar a apólice {0}? Esta acção não pode ser desfeita.", [frm.doc.name]),
                                () => {
                                    frm.call("cancel_policy", { reason: vals.reason }).then(() => {
                                        frm.reload_doc();
                                    });
                                }
                            );
                        },
                        __("Cancelar Apólice"),
                        __("Confirmar")
                    );
                }, __("Acções"));
            }

            // Pending payment — primary action
            if (frm.doc.policy_status === "Pendente de Pagamento") {
                frm.add_custom_button(__("Registar Pagamento"), () => {
                    // amount is set in premium_payment.js onload to avoid
                    // fetch_from chains overwriting values passed here
                    frappe.new_doc("Premium Payment", { policy: frm.doc.name });
                }).addClass("btn-primary");
            }

            // Active — create linked docs
            if (frm.doc.policy_status === "Activa") {
                frm.add_custom_button(__("Participar Sinistro"), () => {
                    frappe.new_doc("Insurance Claim", {
                        policy: frm.doc.name,
                        customer: frm.doc.customer,
                    });
                }, __("Criar"));

                frm.add_custom_button(__("Criar Endosso"), () => {
                    frappe.new_doc("Policy Endorsement", {
                        policy: frm.doc.name,
                        customer: frm.doc.customer,
                    });
                }, __("Criar"));
            }

            // Renewal — show when expired or expiring within 30 days, not already renewed
            const canRenew = !frm.doc.renewed_by && (
                frm.doc.policy_status === "Expirada" ||
                (frm.doc.policy_status === "Activa" && _days_until_expiry(frm) <= 30)
            );

            if (canRenew) {
                const expiringLabel = frm.doc.policy_status === "Activa"
                    ? __("Renovar Apólice ({0} dias para expirar)", [_days_until_expiry(frm)])
                    : __("Renovar Apólice");

                frm.add_custom_button(expiringLabel, () => {
                    _confirm_renewal(frm);
                }).addClass(frm.doc.policy_status === "Expirada" ? "btn-primary" : "");
            }
        }
    },

    // ------------------------------------------------------------------
    // Customer change — pull insurance fields
    // ------------------------------------------------------------------

    customer(frm) {
        if (!frm.doc.customer) return;
        frappe.db.get_value(
            "Customer",
            frm.doc.customer,
            ["customer_bi", "customer_nuit", "customer_dob", "customer_gender",
             "customer_phone_ins", "customer_address_ins"],
            (r) => {
                if (!r) return;
                frm.set_value("customer_bi",     r.customer_bi      || "");
                frm.set_value("customer_nuit",    r.customer_nuit    || "");
                frm.set_value("customer_gender",  r.customer_gender  || "");
                frm.set_value("customer_phone",   r.customer_phone_ins  || "");
                frm.set_value("customer_address", r.customer_address_ins || "");
                if (r.customer_dob) {
                    frm.set_value("customer_dob", r.customer_dob);
                    // DOB handler will fire and calculate age
                }
            }
        );
    },

    // ------------------------------------------------------------------
    // DOB → age (real-time)
    // ------------------------------------------------------------------

    customer_dob(frm) {
        if (!frm.doc.customer_dob) return;
        const dob   = moment(frm.doc.customer_dob);
        const today = moment();
        frm.set_value("customer_age", today.diff(dob, "years"));
    },

    // ------------------------------------------------------------------
    // Beneficiary percentage live warning
    // ------------------------------------------------------------------

    validate(frm) {
        _check_beneficiary_pct(frm);
    },
});

frappe.ui.form.on("Policy Beneficiary", {
    percentage(frm) { _check_beneficiary_pct(frm); },
    beneficiaries_remove(frm) { _check_beneficiary_pct(frm); },
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function _check_beneficiary_pct(frm) {
    if (!frm.doc.beneficiaries || !frm.doc.beneficiaries.length) return;
    const total = frm.doc.beneficiaries.reduce((s, r) => s + (r.percentage || 0), 0);
    if (Math.abs(total - 100) > 0.01) {
        frappe.show_alert({
            message: __("Atenção: a soma das participações dos beneficiários é {0}% (deve ser 100%).", [
                total.toFixed(2),
            ]),
            indicator: total > 100 ? "red" : "orange",
        });
    }
}

function _days_until_expiry(frm) {
    if (!frm.doc.coverage_end_date) return 9999;
    return frappe.datetime.get_diff(frm.doc.coverage_end_date, frappe.datetime.get_today());
}

function _confirm_renewal(frm) {
    // Calculate projected new period for display in the confirmation dialog
    const endDate   = frm.doc.coverage_end_date || "";
    const termMonths = frm.doc.term_months || 12;

    frappe.call({
        method: "frappe.client.get_value",
        args: {
            doctype: "Insurance Policy",
            filters: { name: frm.doc.name },
            fieldname: ["coverage_end_date", "term_months", "premium_amount", "sum_insured"],
        },
        callback(r) {
            const d = r.message || {};
            frappe.confirm(
                __("Renovar apólice {0}?\n\nCliente: {1}\nCapital: {2} MT\nPrémio: {3} MT\nNova vigência: a partir de {4} por {5} meses.", [
                    frm.doc.name,
                    frm.doc.customer_full_name || frm.doc.customer,
                    format_currency(d.sum_insured || frm.doc.sum_insured, "", 2),
                    format_currency(d.premium_amount || frm.doc.premium_amount, "", 2),
                    endDate ? frappe.datetime.add_days(endDate, 1) : "—",
                    d.term_months || termMonths,
                ]),
                () => {
                    frm.call("renew_policy").then(r => {
                        if (r.message) {
                            frappe.show_alert({
                                message: __("Apólice {0} criada. Aguarda pagamento.", [r.message]),
                                indicator: "green",
                            });
                            frappe.set_route("Form", "Insurance Policy", r.message);
                        }
                    });
                }
            );
        },
    });
}

function _set_status_indicator(frm) {
    const colour = {
        "Activa":                "green",
        "Pendente de Pagamento": "orange",
        "Cancelada":             "red",
        "Expirada":              "grey",
        "Sinistrada":            "purple",
    }[frm.doc.policy_status] || "grey";

    frm.dashboard.add_indicator(
        __(frm.doc.policy_status || "Sem Estado"),
        colour
    );
}
