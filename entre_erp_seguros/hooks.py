app_name = "entre_erp_seguros"
app_title = "Entre Erp Seguros"
app_publisher = "Entretech"
app_description = "Sistema de Gestão de Seguros para Moçambique"
app_email = "info@entretech.co.mz"
app_license = "MIT"
app_version = "0.0.1"

# App icon shown in the desk
app_icon = "octicon octicon-shield"
app_color = "#F57C00"

# ------------------------------------------------------------------
# Lifecycle hooks
# ------------------------------------------------------------------

after_install = "entre_erp_seguros.install.after_install"
after_migrate = "entre_erp_seguros.install.after_install"

# ------------------------------------------------------------------
# Scheduled tasks
# ------------------------------------------------------------------

scheduler_events = {
    "daily": [
        "entre_erp_seguros.utils.expiry_checker.check_expired_policies"
    ]
}

# ------------------------------------------------------------------
# Fixtures — exported with bench export-fixtures
# ------------------------------------------------------------------

fixtures = [
    {
        "dt": "Custom Field",
        "filters": [["module", "=", "Entre Erp Seguros"]]
    },
    {
        "dt": "Insurance Branch",
        "filters": []
    },
    {
        "dt": "Risk Factor Template",
        "filters": []
    },
    {
        "dt": "Insurance Product",
        "filters": []
    },
    {
        "dt": "Workspace",
        "filters": [["name", "=", "Seguros"]]
    },
    {
        "dt": "Print Format",
        "filters": [["module", "=", "Entre Erp Seguros"]]
    },
]

# ------------------------------------------------------------------
# Public website routes
# ------------------------------------------------------------------

# /verify?p=APL-2024-00001  →  www/verify.html + www/verify.py
# No route_rules needed; the www/ file is served automatically.

# ------------------------------------------------------------------
# DocType event hooks
# ------------------------------------------------------------------

doc_events = {
    "Customer": {
        "validate": "entre_erp_seguros.events.customer_events.on_customer_validate"
    }
}

# ------------------------------------------------------------------
# Assets
# ------------------------------------------------------------------

# app_include_css = "/assets/entre_erp_seguros/css/entre_erp_seguros.css"
# app_include_js  = "/assets/entre_erp_seguros/js/entre_erp_seguros.js"
