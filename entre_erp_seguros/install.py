import os

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def after_install():
    _create_customer_custom_fields()
    _ensure_customer_age_field()
    _create_insurance_branches()       # must run before products
    _create_sample_products_and_rates()
    _create_print_formats()
    _create_mode_of_payments()
    _create_insurance_item()
    _create_workspace()
    frappe.db.commit()


# ------------------------------------------------------------------
# Customer custom fields
# ------------------------------------------------------------------

def _create_customer_custom_fields():
    """Add insurance-specific fields to the standard Customer doctype."""
    existing = frappe.db.get_all(
        "Custom Field",
        filters={"dt": "Customer", "fieldname": "customer_bi"},
        limit=1,
    )
    if existing:
        return

    custom_fields = {
        "Customer": [
            {
                "fieldname": "insurance_section",
                "label": "Dados de Seguro",
                "fieldtype": "Section Break",
                "insert_after": "customer_name",
                "collapsible": 1,
                "module": "Entre Erp Seguros",
            },
            {
                "fieldname": "customer_bi",
                "label": "Bilhete de Identidade (BI)",
                "fieldtype": "Data",
                "insert_after": "insurance_section",
                "module": "Entre Erp Seguros",
            },
            {
                "fieldname": "customer_nuit",
                "label": "NUIT",
                "fieldtype": "Data",
                "insert_after": "customer_bi",
                "module": "Entre Erp Seguros",
            },
            {
                "fieldname": "col_break_insurance",
                "fieldtype": "Column Break",
                "insert_after": "customer_nuit",
                "module": "Entre Erp Seguros",
            },
            {
                "fieldname": "customer_dob",
                "label": "Data de Nascimento",
                "fieldtype": "Date",
                "insert_after": "col_break_insurance",
                "module": "Entre Erp Seguros",
            },
            {
                "fieldname": "customer_age",
                "label": "Idade (anos)",
                "fieldtype": "Int",
                "insert_after": "customer_dob",
                "read_only": 1,
                "module": "Entre Erp Seguros",
            },
            {
                "fieldname": "customer_gender",
                "label": "Género",
                "fieldtype": "Select",
                "options": "\nMasculino\nFeminino",
                "insert_after": "customer_age",
                "module": "Entre Erp Seguros",
            },
            {
                "fieldname": "customer_phone_ins",
                "label": "Telefone",
                "fieldtype": "Data",
                "insert_after": "customer_gender",
                "module": "Entre Erp Seguros",
            },
            {
                "fieldname": "customer_address_ins",
                "label": "Endereço",
                "fieldtype": "Data",
                "insert_after": "customer_phone_ins",
                "module": "Entre Erp Seguros",
            },
        ]
    }
    create_custom_fields(custom_fields, ignore_validate=True)


def _ensure_customer_age_field():
    """
    Idempotently adds customer_age to Customer for existing installs where
    _create_customer_custom_fields() already ran without this field.
    """
    if frappe.db.exists("Custom Field", {"dt": "Customer", "fieldname": "customer_age"}):
        return
    create_custom_fields({
        "Customer": [
            {
                "fieldname": "customer_age",
                "label": "Idade (anos)",
                "fieldtype": "Int",
                "insert_after": "customer_dob",
                "read_only": 1,
                "module": "Entre Erp Seguros",
            }
        ]
    }, ignore_validate=True)


# ------------------------------------------------------------------
# Insurance Branches (must exist before products are created)
# ------------------------------------------------------------------

def _create_insurance_branches():
    """
    Idempotently creates the four core insurance branches.
    Also created by fixtures; this runs first so products can reference them.
    """
    branches = [
        {
            "name": "Vida/Crédito",
            "branch_code": "VIDA",
            "description": "Seguros de vida, crédito e acidentes pessoais.",
        },
        {
            "name": "Automóvel",
            "branch_code": "AUTO",
            "description": "Seguros para veículos automóveis, motociclos e veículos comerciais.",
        },
        {
            "name": "Habitação",
            "branch_code": "HABIT",
            "description": "Seguros para imóveis residenciais e conteúdos domésticos.",
        },
        {
            "name": "Funeral",
            "branch_code": "FUN",
            "description": "Seguros de assistência funeral e despesas associadas.",
        },
    ]
    for b in branches:
        if frappe.db.exists("Insurance Branch", b["name"]):
            continue
        doc = frappe.new_doc("Insurance Branch")
        doc.branch_name = b["name"]
        doc.branch_code = b["branch_code"]
        doc.description = b["description"]
        doc.is_active = 1
        doc.insert(ignore_permissions=True)


# ------------------------------------------------------------------
# Sample Insurance Products + Premium Rate Tables
# ------------------------------------------------------------------

def _create_sample_products_and_rates():
    """
    Creates one Insurance Product per branch (if none exist yet)
    and matching flat-rate Premium Rate Table entries so the system
    is immediately usable for demos.
    Idempotent — skipped if products already exist for a branch.
    """
    products = [
        {
            "product_name": "Seguro de Vida Individual",
            "branch": "Vida/Crédito",
            "risk_factor_template": "Template VIDA",
            "min_age": 18, "max_age": 65,
            "min_term_months": 12, "max_term_months": 120,
            "min_sum_insured": 50000, "max_sum_insured": 5000000,
            "status": "Activo",
            "rates": [
                {"rate_name": "Taxa Padrão VIDA", "base_rate_pct": 0.80,
                 "min_age": 18, "max_age": 40},
                {"rate_name": "Taxa VIDA 41-55", "base_rate_pct": 1.10,
                 "min_age": 41, "max_age": 55},
                {"rate_name": "Taxa VIDA 56-65", "base_rate_pct": 1.50,
                 "min_age": 56, "max_age": 65},
            ],
        },
        {
            "product_name": "Seguro Automóvel",
            "branch": "Automóvel",
            "risk_factor_template": "Template AUTO",
            "min_age": 18, "max_age": 75,
            "min_term_months": 12, "max_term_months": 12,
            "min_sum_insured": 100000, "max_sum_insured": 10000000,
            "status": "Activo",
            "rates": [
                {"rate_name": "Taxa AUTO Padrão", "base_rate_pct": 2.00},
            ],
        },
        {
            "product_name": "Seguro de Habitação",
            "branch": "Habitação",
            "risk_factor_template": "Template HABITAÇÃO",
            "min_age": 18, "max_age": 75,
            "min_term_months": 12, "max_term_months": 60,
            "min_sum_insured": 200000, "max_sum_insured": 20000000,
            "status": "Activo",
            "rates": [
                {"rate_name": "Taxa HABIT Padrão", "base_rate_pct": 0.45},
            ],
        },
        {
            "product_name": "Seguro Funeral",
            "branch": "Funeral",
            "risk_factor_template": None,
            "min_age": 0, "max_age": 85,
            "min_term_months": 12, "max_term_months": 12,
            "min_sum_insured": 5000, "max_sum_insured": 200000,
            "status": "Activo",
            "rates": [
                {"rate_name": "Taxa FUNERAL Padrão", "base_rate_pct": 1.20},
            ],
        },
    ]

    for cfg in products:
        # Skip if a product already exists for this branch
        existing = frappe.db.get_all(
            "Insurance Product",
            filters={"branch": cfg["branch"]},
            limit=1,
        )
        if existing:
            continue

        # Verify branch fixture was already imported
        if not frappe.db.exists("Insurance Branch", cfg["branch"]):
            frappe.log_error(
                title=f"install: branch '{cfg['branch']}' not found — skipping product",
                message="Import fixtures before running install.",
            )
            continue

        product = frappe.new_doc("Insurance Product")
        product.update({
            "product_name": cfg["product_name"],
            "branch": cfg["branch"],
            "risk_factor_template": cfg.get("risk_factor_template"),
            "min_age": cfg["min_age"],
            "max_age": cfg["max_age"],
            "min_term_months": cfg["min_term_months"],
            "max_term_months": cfg["max_term_months"],
            "min_sum_insured": cfg["min_sum_insured"],
            "max_sum_insured": cfg["max_sum_insured"],
            "status": cfg["status"],
            "is_active": 1,
        })
        product.insert(ignore_permissions=True, ignore_links=True)

        # Create rate table entries for this product
        for rate_cfg in cfg.get("rates", []):
            rate = frappe.new_doc("Premium Rate Table")
            rate.update({
                "product": product.name,
                "rate_name": rate_cfg["rate_name"],
                "base_rate_pct": rate_cfg["base_rate_pct"],
                "min_age": rate_cfg.get("min_age"),
                "max_age": rate_cfg.get("max_age"),
                "is_active": 1,
            })
            rate.insert(ignore_permissions=True)


# ------------------------------------------------------------------
# Print Formats
# ------------------------------------------------------------------

def _create_print_formats():
    """
    Register the HTML print formats shipped with the app.
    Reads the HTML files from the doctype folders.
    Idempotent — existing print formats are not overwritten.
    """
    app_dir = os.path.dirname(__file__)  # entre_erp_seguros/ (package root)

    formats = [
        {
            "name": "Apólice de Seguro",
            "doc_type": "Insurance Policy",
            "html_path": os.path.join(
                app_dir, "entre_erp_seguros", "doctype",
                "insurance_policy", "apolice_de_seguro.html"
            ),
        },
        {
            "name": "Cotação de Seguro",
            "doc_type": "Insurance Quotation",
            "html_path": os.path.join(
                app_dir, "entre_erp_seguros", "doctype",
                "insurance_quotation", "cotacao_de_seguro.html"
            ),
        },
        {
            "name": "Recibo de Indemnização",
            "doc_type": "Claim Settlement Receipt",
            "html_path": os.path.join(
                app_dir, "entre_erp_seguros", "doctype",
                "claim_settlement_receipt", "recibo_de_indemnizacao.html"
            ),
        },
        {
            "name": "Participação de Sinistro",
            "doc_type": "Insurance Claim",
            "html_path": os.path.join(
                app_dir, "entre_erp_seguros", "doctype",
                "insurance_claim", "participacao_de_sinistro.html"
            ),
        },
        {
            "name": "Endosso de Apólice",
            "doc_type": "Policy Endorsement",
            "html_path": os.path.join(
                app_dir, "entre_erp_seguros", "doctype",
                "policy_endorsement", "endosso_de_apolice.html"
            ),
        },
    ]

    for fmt in formats:
        if frappe.db.exists("Print Format", fmt["name"]):
            continue

        if not os.path.exists(fmt["html_path"]):
            frappe.log_error(
                title=f"install: print format HTML not found: {fmt['html_path']}",
                message="Verify app installation structure.",
            )
            continue

        with open(fmt["html_path"], encoding="utf-8") as f:
            html_content = f.read()

        pf = frappe.new_doc("Print Format")
        pf.name = fmt["name"]
        pf.doc_type = fmt["doc_type"]
        pf.module = "Entre Erp Seguros"
        pf.standard = "Yes"
        pf.print_format_type = "Jinja"
        pf.html = html_content
        pf.insert(ignore_permissions=True)


# ------------------------------------------------------------------
# Mode of Payment records
# ------------------------------------------------------------------

def _create_mode_of_payments():
    """
    Ensure M-Pesa and e-Mola exist as Mode of Payment records.
    Cash, Bank Transfer and Cheque are shipped with ERPNext by default.
    Idempotent — skips if the record already exists.
    """
    mobile_modes = [
        {"mode_of_payment": "M-Pesa",  "type": "Bank"},
        {"mode_of_payment": "e-Mola",  "type": "Bank"},
    ]
    for cfg in mobile_modes:
        if frappe.db.exists("Mode of Payment", cfg["mode_of_payment"]):
            continue
        mop = frappe.new_doc("Mode of Payment")
        mop.mode_of_payment = cfg["mode_of_payment"]
        mop.type = cfg["type"]
        mop.enabled = 1
        mop.insert(ignore_permissions=True)


# ------------------------------------------------------------------
# Insurance Item (used in Sales Invoices)
# ------------------------------------------------------------------

def _create_insurance_item():
    """
    Create the generic 'Prémio de Seguro' item used when generating
    Sales Invoices on premium payment.  Idempotent.
    """
    item_code = "Prémio de Seguro"
    if frappe.db.exists("Item", item_code):
        return

    # Resolve item group: prefer "Services", fall back to whatever root group exists
    for candidate in ("Services", "Serviços", "All Item Groups"):
        if frappe.db.exists("Item Group", candidate):
            item_group = candidate
            break
    else:
        item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"

    item = frappe.new_doc("Item")
    item.update({
        "item_code": item_code,
        "item_name": item_code,
        "item_group": item_group,
        "stock_uom": "Nos",
        "is_stock_item": 0,
        "is_purchase_item": 0,
        "is_sales_item": 1,
        "description": "Prémio de seguro — gerado automaticamente pelo sistema.",
    })
    item.insert(ignore_permissions=True)


# ------------------------------------------------------------------
# Workspace
# ------------------------------------------------------------------

def _create_workspace():
    """
    Creates the Seguros workspace with shortcuts.
    Bypasses mandatory/link validation so child-table quirks in different
    Frappe v15 patch levels don't block installation.
    Idempotent — skips if the workspace already exists.
    """
    if frappe.db.exists("Workspace", "Seguros"):
        return

    ws = frappe.new_doc("Workspace")
    ws.update({
        "name": "Seguros",
        "title": "Seguros",
        "module": "Entre Erp Seguros",
        "icon": "shield",
        "indicator_color": "orange",
        "is_standard": 1,
        "public": 1,
        "sequence_id": 1.0,
        "content": "[]",
    })

    for s in [
        {"type": "DocType", "label": "Cotações",   "link_to": "Insurance Quotation",     "icon": "file-text",   "color": "#F57C00"},
        {"type": "DocType", "label": "Apólices",   "link_to": "Insurance Policy",         "icon": "shield",      "color": "#2e7d32"},
        {"type": "DocType", "label": "Pagamentos", "link_to": "Premium Payment",          "icon": "credit-card", "color": "#1565c0"},
        {"type": "DocType", "label": "Sinistros",  "link_to": "Insurance Claim",          "icon": "alert-circle","color": "#c62828"},
        {"type": "DocType", "label": "Recibos",    "link_to": "Claim Settlement Receipt", "icon": "file-text",   "color": "#2e7d32"},
        {"type": "DocType", "label": "Produtos",   "link_to": "Insurance Product",        "icon": "package",     "color": "#6a1b9a"},
    ]:
        ws.append("shortcuts", s)

    ws.insert(ignore_permissions=True, ignore_mandatory=True, ignore_links=True)
