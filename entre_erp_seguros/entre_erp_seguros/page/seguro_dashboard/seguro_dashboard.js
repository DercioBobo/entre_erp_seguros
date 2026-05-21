frappe.pages['seguro-dashboard'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Dashboard de Seguros',
		single_column: true,
	});
	wrapper._sd = new SegurosDashboard(wrapper);
};

frappe.pages['seguro-dashboard'].on_page_show = function (wrapper) {
	wrapper._sd && wrapper._sd.refresh();
};

/* ------------------------------------------------------------------ */
class SegurosDashboard {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.$main  = $(wrapper).find('.layout-main-section');
		this._search_timer = null;
		this._inject_css();
		this._build_skeleton();
		this.refresh();
	}

	refresh() {
		this._load_kpis();
	}

	/* ── Skeleton ─────────────────────────────────────────────────── */
	_build_skeleton() {
		this.$main.empty().append(`
			<div class="sd-wrap">
				<!-- KPI row -->
				<div class="sd-kpi-row" id="sd-kpis"></div>

				<!-- Search -->
				<div class="sd-search-bar">
					<span class="sd-search-icon">&#128270;</span>
					<input id="sd-search-input" type="text"
						placeholder="Pesquisar cliente por nome, BI ou telefone…"
						autocomplete="off" />
					<span class="sd-search-clear" id="sd-search-clear" title="Limpar">&#10005;</span>
				</div>

				<!-- Hint / counter -->
				<div class="sd-hint" id="sd-hint">
					Escreva pelo menos 2 caracteres para pesquisar.
				</div>

				<!-- Customer cards grid -->
				<div class="sd-grid" id="sd-grid"></div>
			</div>
		`);

		/* search events */
		const $inp   = this.$main.find('#sd-search-input');
		const $clear = this.$main.find('#sd-search-clear');

		$inp.on('input', () => {
			clearTimeout(this._search_timer);
			const q = $inp.val().trim();
			if (q.length < 2) {
				this._set_hint('Escreva pelo menos 2 caracteres para pesquisar.');
				this.$main.find('#sd-grid').empty();
				$clear.toggle(false);
				return;
			}
			$clear.toggle(true);
			this._set_hint('<span class="sd-spinner"></span> A pesquisar…');
			this._search_timer = setTimeout(() => this._do_search(q), 320);
		});

		$clear.on('click', () => {
			$inp.val('').trigger('input').focus();
		});
	}

	/* ── KPIs ─────────────────────────────────────────────────────── */
	_load_kpis() {
		const $row = this.$main.find('#sd-kpis');
		$row.html(this._shimmer_kpis());

		frappe.call({
			method: 'entre_erp_seguros.entre_erp_seguros.page.seguro_dashboard.seguro_dashboard.get_dashboard_stats',
			callback: (r) => {
				if (!r.message) return;
				const d = r.message;
				$row.html(this._render_kpis(d));

				/* click-throughs */
				$row.find('[data-kpi="active"]').on('click', () =>
					frappe.set_route('List', 'Insurance Policy', {policy_status: 'Activa'}));
				$row.find('[data-kpi="pending"]').on('click', () =>
					frappe.set_route('List', 'Insurance Policy', {policy_status: 'Pendente de Pagamento'}));
				$row.find('[data-kpi="claims"]').on('click', () =>
					frappe.set_route('List', 'Insurance Claim'));
				$row.find('[data-kpi="expiring"]').on('click', () =>
					frappe.set_route('List', 'Insurance Policy', {policy_status: 'Activa'}));
			},
		});
	}

	_render_kpis(d) {
		const fmt_n = (v) => frappe.utils.numberFormat(v || 0, 0);
		const fmt_c = (v) => 'MT ' + frappe.utils.numberFormat(v || 0, 2);

		const cards = [
			{
				key: 'active', icon: '🛡️', label: 'Apólices Activas',
				value: fmt_n(d.active_policies), color: '#2e7d32', bg: '#e8f5e9',
			},
			{
				key: 'capital', icon: '💰', label: 'Capital Segurado Total',
				value: fmt_c(d.total_capital), color: '#1565c0', bg: '#e3f2fd',
			},
			{
				key: 'premium', icon: '📋', label: 'Prémio Anual (Activas)',
				value: fmt_c(d.total_premium), color: '#6a1b9a', bg: '#f3e5f5',
			},
			{
				key: 'claims', icon: '⚠️', label: 'Sinistros em Aberto',
				value: fmt_n(d.open_claims), color: '#c62828', bg: '#ffebee',
			},
			{
				key: 'expiring', icon: '⏳', label: 'A Vencer em 30 dias',
				value: fmt_n(d.expiring_30d), color: '#e65100', bg: '#fff3e0',
			},
			{
				key: 'pending', icon: '🔔', label: 'Pendentes de Pagamento',
				value: fmt_n(d.pending_payment), color: '#f57f17', bg: '#fffde7',
			},
		];

		return cards.map(c => `
			<div class="sd-kpi-card" data-kpi="${c.key}"
				style="--kc:${c.color};--kb:${c.bg}">
				<div class="sd-kpi-icon">${c.icon}</div>
				<div class="sd-kpi-val">${c.value}</div>
				<div class="sd-kpi-lbl">${c.label}</div>
			</div>
		`).join('');
	}

	_shimmer_kpis() {
		return Array(6).fill(0).map(() =>
			`<div class="sd-kpi-card sd-shimmer" style="--kc:#aaa;--kb:#f5f5f5">
				<div style="height:32px;width:32px;border-radius:50%;background:#ddd;margin:0 auto 8px"></div>
				<div style="height:24px;width:70%;background:#ddd;border-radius:4px;margin:0 auto 6px"></div>
				<div style="height:14px;width:90%;background:#eee;border-radius:4px;margin:0 auto"></div>
			</div>`
		).join('');
	}

	/* ── Search ───────────────────────────────────────────────────── */
	_do_search(query) {
		frappe.call({
			method: 'entre_erp_seguros.entre_erp_seguros.page.seguro_dashboard.seguro_dashboard.search_customers',
			args: { query, limit: 24 },
			callback: (r) => {
				const rows = r.message || [];
				if (!rows.length) {
					this._set_hint('Nenhum cliente encontrado para <strong>' +
						frappe.utils.escape_html(query) + '</strong>.');
					this.$main.find('#sd-grid').empty();
					return;
				}
				this._set_hint(`${rows.length} cliente(s) encontrado(s).`);
				this._render_grid(rows);
			},
		});
	}

	_render_grid(rows) {
		const $grid = this.$main.find('#sd-grid');
		$grid.empty();

		rows.forEach(r => {
			const initials = this._initials(r.customer_full_name);
			const color    = this._avatar_color(r.customer || r.customer_full_name);
			const branch_html = r.branches
				? `<span class="sd-badge sd-badge-gray">${frappe.utils.escape_html(r.branches)}</span>`
				: '';
			const claim_html = r.open_claims > 0
				? `<span class="sd-badge sd-badge-red">⚠ ${r.open_claims} sinistro${r.open_claims > 1 ? 's' : ''}</span>`
				: '';
			const fmt_c = (v) => 'MT ' + frappe.utils.format_number(v || 0, null, 2);

			const $card = $(`
				<div class="sd-cust-card">
					<div class="sd-avatar" style="background:${color}">${initials}</div>
					<div class="sd-cust-info">
						<div class="sd-cust-name">${frappe.utils.escape_html(r.customer_full_name)}</div>
						<div class="sd-cust-sub">${frappe.utils.escape_html(r.phone || '—')}</div>
						<div class="sd-cust-badges">
							<span class="sd-badge sd-badge-green">${r.active_count} activa${r.active_count !== 1 ? 's' : ''}</span>
							<span class="sd-badge sd-badge-blue">${r.total_policies} apólice${r.total_policies !== 1 ? 's' : ''}</span>
							${claim_html}
							${branch_html}
						</div>
						<div class="sd-cust-capital">${fmt_c(r.total_capital)}</div>
					</div>
					<div class="sd-cust-arrow">›</div>
				</div>
			`);

			$card.on('click', () => this._open_modal(r.customer, r.customer_full_name));
			$grid.append($card);
		});
	}

	_set_hint(html) {
		this.$main.find('#sd-hint').html(html);
	}

	/* ── Customer Modal ───────────────────────────────────────────── */
	_open_modal(customer, name) {
		$('#sd-modal-backdrop').remove();

		const $bd = $(`
			<div id="sd-modal-backdrop">
				<div id="sd-modal">
					<div id="sd-modal-header">
						<div class="sdm-avatar" id="sdm-avatar"></div>
						<div class="sdm-title-block">
							<h3 id="sdm-name"></h3>
							<div id="sdm-sub"></div>
						</div>
						<button id="sd-modal-close" title="Fechar">&#10005;</button>
					</div>
					<div id="sdm-mini-stats"></div>
					<div id="sdm-tabs">
						<button class="sdm-tab sdm-tab-active" data-tab="policies">Apólices</button>
						<button class="sdm-tab" data-tab="claims">Sinistros</button>
						<button class="sdm-tab" data-tab="payments">Pagamentos</button>
						<button class="sdm-tab" data-tab="endorsements">Endossos</button>
					</div>
					<div id="sdm-body">
						<div class="sdm-loading"><span class="sd-spinner sd-spinner-lg"></span></div>
					</div>
					<div id="sdm-footer">
						<a id="sdm-link-customer" href="#" class="sdm-btn sdm-btn-outline">Ver Cliente</a>
						<a id="sdm-link-list-apolices" href="#" class="sdm-btn sdm-btn-outline">Ver Apólices</a>
					</div>
				</div>
			</div>
		`);

		$('body').append($bd);
		this._active_tab = 'policies';

		/* close */
		$bd.on('click', (e) => {
			if (e.target === $bd[0]) $bd.remove();
		});
		$bd.find('#sd-modal-close').on('click', () => $bd.remove());
		$(document).on('keydown.sdmodal', (e) => {
			if (e.key === 'Escape') { $bd.remove(); $(document).off('keydown.sdmodal'); }
		});

		/* tabs */
		$bd.find('.sdm-tab').on('click', (e) => {
			const tab = $(e.currentTarget).data('tab');
			$bd.find('.sdm-tab').removeClass('sdm-tab-active');
			$(e.currentTarget).addClass('sdm-tab-active');
			this._active_tab = tab;
			this._render_tab(tab, this._modal_data);
		});

		/* footer links */
		$bd.find('#sdm-link-customer').attr('href',
			frappe.utils.get_form_link('Customer', customer));
		$bd.find('#sdm-link-list-apolices').attr('href',
			'/app/insurance-policy?customer=' + encodeURIComponent(customer));

		/* load data */
		frappe.call({
			method: 'entre_erp_seguros.entre_erp_seguros.page.seguro_dashboard.seguro_dashboard.get_customer_detail',
			args: { customer },
			callback: (r) => {
				const d = r.message || {};
				this._modal_data = d;

				const color    = this._avatar_color(customer);
				const initials = this._initials(d.profile.customer_full_name || name);

				$bd.find('#sdm-avatar')
					.css('background', color)
					.text(initials);
				$bd.find('#sdm-name').text(d.profile.customer_full_name || name);

				const sub_parts = [];
				if (d.profile.customer_phone_ins) sub_parts.push(d.profile.customer_phone_ins);
				if (d.profile.customer_bi)        sub_parts.push('BI: ' + d.profile.customer_bi);
				if (d.profile.customer_nuit)      sub_parts.push('NUIT: ' + d.profile.customer_nuit);
				if (d.profile.customer_age)       sub_parts.push(d.profile.customer_age + ' anos');
				if (d.profile.customer_gender)    sub_parts.push(d.profile.customer_gender);
				$bd.find('#sdm-sub').text(sub_parts.join('  ·  '));

				/* mini stats */
				const active  = (d.policies || []).filter(p => p.policy_status === 'Activa').length;
				const open_c  = (d.claims   || []).filter(c => !['Liquidado','Cancelado','Rejeitado'].includes(c.status)).length;
				const total_c = (d.claims   || []).length;
				const total_p = (d.payments || []).filter(p => p.status === 'Submetido').length;
				const total_e = (d.endorsements || []).length;
				$bd.find('#sdm-mini-stats').html(`
					<div class="sdm-ms-row">
						<div class="sdm-ms-item"><span class="sdm-ms-num">${active}</span><span class="sdm-ms-lbl">Activas</span></div>
						<div class="sdm-ms-item"><span class="sdm-ms-num">${d.policies.length}</span><span class="sdm-ms-lbl">Apólices</span></div>
						<div class="sdm-ms-item"><span class="sdm-ms-num ${open_c > 0 ? 'sdm-ms-red' : ''}">${open_c}</span><span class="sdm-ms-lbl">Sinistros Abertos</span></div>
						<div class="sdm-ms-item"><span class="sdm-ms-num">${total_c}</span><span class="sdm-ms-lbl">Total Sinistros</span></div>
						<div class="sdm-ms-item"><span class="sdm-ms-num">${total_p}</span><span class="sdm-ms-lbl">Pagamentos</span></div>
						<div class="sdm-ms-item"><span class="sdm-ms-num">${total_e}</span><span class="sdm-ms-lbl">Endossos</span></div>
					</div>
				`);

				this._render_tab('policies', d);
			},
		});
	}

	_render_tab(tab, d) {
		const $body = $('#sdm-body');
		if (!d) {
			$body.html('<div class="sdm-loading"><span class="sd-spinner sd-spinner-lg"></span></div>');
			return;
		}

		if (tab === 'policies')    $body.html(this._tab_policies(d.policies || []));
		if (tab === 'claims')      $body.html(this._tab_claims(d.claims || []));
		if (tab === 'payments')    $body.html(this._tab_payments(d.payments || []));
		if (tab === 'endorsements') $body.html(this._tab_endorsements(d.endorsements || []));

		/* click row to open form */
		$body.find('[data-doctype][data-name]').on('click', (e) => {
			const $el = $(e.currentTarget);
			frappe.set_route('Form', $el.data('doctype'), $el.data('name'));
		});
	}

	_tab_policies(rows) {
		if (!rows.length) return '<div class="sdm-empty">Nenhuma apólice encontrada.</div>';
		const STATUS_COLOR = {
			'Activa':                'green',
			'Pendente de Pagamento': 'yellow',
			'Cancelada':             'red',
			'Expirada':              'gray',
			'Suspensa':              'orange',
		};
		return `
			<table class="sdm-table">
				<thead><tr>
					<th>Apólice</th><th>Produto / Ramo</th><th>Estado</th>
					<th>Vigência</th><th>Capital (MT)</th><th>Prémio (MT)</th>
				</tr></thead>
				<tbody>
				${rows.map(p => `
					<tr class="sdm-row" data-doctype="Insurance Policy" data-name="${frappe.utils.escape_html(p.name)}">
						<td><code>${frappe.utils.escape_html(p.name)}</code></td>
						<td>${frappe.utils.escape_html(p.insurance_product || p.branch || '—')}</td>
						<td><span class="sdm-status sdm-status-${STATUS_COLOR[p.policy_status] || 'gray'}">${frappe.utils.escape_html(p.policy_status || '—')}</span></td>
						<td>${this._fmt_date(p.coverage_start_date)} → ${this._fmt_date(p.coverage_end_date)}</td>
						<td class="sdm-num">${this._fmt_c(p.sum_insured)}</td>
						<td class="sdm-num">${this._fmt_c(p.premium_amount)}</td>
					</tr>
				`).join('')}
				</tbody>
			</table>
		`;
	}

	_tab_claims(rows) {
		if (!rows.length) return '<div class="sdm-empty">Nenhum sinistro encontrado.</div>';
		const STATUS_COLOR = {
			'Rascunho':              'gray',
			'Submetido':             'blue',
			'Em Análise':            'orange',
			'Pendente Documentação': 'yellow',
			'Aprovado':              'green',
			'Rejeitado':             'red',
			'Em Liquidação':         'purple',
			'Liquidado':             'green',
			'Cancelado':             'gray',
		};
		return `
			<table class="sdm-table">
				<thead><tr>
					<th>Sinistro</th><th>Apólice</th><th>Tipo</th>
					<th>Estado</th><th>Data</th><th>Reclamado (MT)</th><th>Aprovado (MT)</th>
				</tr></thead>
				<tbody>
				${rows.map(c => `
					<tr class="sdm-row" data-doctype="Insurance Claim" data-name="${frappe.utils.escape_html(c.name)}">
						<td><code>${frappe.utils.escape_html(c.name)}</code></td>
						<td><code>${frappe.utils.escape_html(c.policy || '—')}</code></td>
						<td>${frappe.utils.escape_html(c.claim_type || '—')}</td>
						<td><span class="sdm-status sdm-status-${STATUS_COLOR[c.status] || 'gray'}">${frappe.utils.escape_html(c.status || '—')}</span></td>
						<td>${this._fmt_date(c.incident_date)}</td>
						<td class="sdm-num">${this._fmt_c(c.claimed_amount)}</td>
						<td class="sdm-num">${this._fmt_c(c.approved_amount)}</td>
					</tr>
				`).join('')}
				</tbody>
			</table>
		`;
	}

	_tab_payments(rows) {
		if (!rows.length) return '<div class="sdm-empty">Nenhum pagamento encontrado.</div>';
		const STATUS_COLOR = {
			'Rascunho':  'gray',
			'Submetido': 'green',
			'Cancelado': 'red',
		};
		return `
			<table class="sdm-table">
				<thead><tr>
					<th>Referência</th><th>Apólice</th><th>Estado</th>
					<th>Data</th><th>Método</th><th>Montante (MT)</th>
				</tr></thead>
				<tbody>
				${rows.map(p => `
					<tr class="sdm-row" data-doctype="Premium Payment" data-name="${frappe.utils.escape_html(p.name)}">
						<td><code>${frappe.utils.escape_html(p.name)}</code></td>
						<td><code>${frappe.utils.escape_html(p.policy || '—')}</code></td>
						<td><span class="sdm-status sdm-status-${STATUS_COLOR[p.status] || 'gray'}">${frappe.utils.escape_html(p.status || '—')}</span></td>
						<td>${this._fmt_date(p.payment_date)}</td>
						<td>${frappe.utils.escape_html(p.payment_method || '—')}</td>
						<td class="sdm-num">${this._fmt_c(p.amount)}</td>
					</tr>
				`).join('')}
				</tbody>
			</table>
		`;
	}

	_tab_endorsements(rows) {
		if (!rows.length) return '<div class="sdm-empty">Nenhum endosso encontrado.</div>';
		const STATUS_COLOR = {
			'Rascunho':                'gray',
			'Pendente de Aprovação':   'orange',
			'Aprovado':                'green',
			'Recusado':                'red',
		};
		return `
			<table class="sdm-table">
				<thead><tr>
					<th>Endosso</th><th>Apólice</th><th>Tipo</th>
					<th>Estado</th><th>Vigência</th><th>Prémio Adicional (MT)</th>
				</tr></thead>
				<tbody>
				${rows.map(e => `
					<tr class="sdm-row" data-doctype="Policy Endorsement" data-name="${frappe.utils.escape_html(e.name)}">
						<td><code>${frappe.utils.escape_html(e.name)}</code></td>
						<td><code>${frappe.utils.escape_html(e.policy || '—')}</code></td>
						<td>${frappe.utils.escape_html(e.endorsement_type || '—')}</td>
						<td><span class="sdm-status sdm-status-${STATUS_COLOR[e.status] || 'gray'}">${frappe.utils.escape_html(e.status || '—')}</span></td>
						<td>${this._fmt_date(e.effective_date)}</td>
						<td class="sdm-num">${this._fmt_c(e.additional_premium)}</td>
					</tr>
				`).join('')}
				</tbody>
			</table>
		`;
	}

	/* ── Helpers ──────────────────────────────────────────────────── */
	_fmt_date(d) {
		if (!d) return '—';
		return frappe.datetime.str_to_user(d) || d;
	}

	_fmt_c(v) {
		if (!v && v !== 0) return '—';
		return frappe.utils.format_number(v, null, 2);
	}

	_initials(name) {
		if (!name) return '?';
		return name.trim().split(/\s+/).slice(0, 2)
			.map(w => w[0].toUpperCase()).join('');
	}

	_avatar_color(seed) {
		const COLORS = [
			'#1565c0','#2e7d32','#6a1b9a','#c62828',
			'#e65100','#00695c','#4527a0','#283593',
		];
		let h = 0;
		for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
		return COLORS[h % COLORS.length];
	}

	/* ── CSS ──────────────────────────────────────────────────────── */
	_inject_css() {
		if (document.getElementById('_sd_css')) return;
		const css = `
/* ── Dashboard wrap ── */
.sd-wrap { padding: 24px 0; }

/* ── KPI row ── */
.sd-kpi-row {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
	gap: 14px;
	margin-bottom: 28px;
}
.sd-kpi-card {
	background: var(--kb);
	border: 1px solid color-mix(in srgb, var(--kc) 25%, transparent);
	border-radius: 12px;
	padding: 18px 14px 14px;
	text-align: center;
	cursor: pointer;
	transition: transform .15s, box-shadow .15s;
}
.sd-kpi-card:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(0,0,0,.10); }
.sd-kpi-icon { font-size: 28px; line-height: 1; margin-bottom: 8px; }
.sd-kpi-val  { font-size: 20px; font-weight: 700; color: var(--kc); line-height: 1.2; }
.sd-kpi-lbl  { font-size: 11px; color: #666; margin-top: 4px; line-height: 1.3; }

/* ── Shimmer ── */
.sd-shimmer { animation: sd-pulse 1.4s ease-in-out infinite; }
@keyframes sd-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }

/* ── Search bar ── */
.sd-search-bar {
	display: flex; align-items: center;
	background: #fff;
	border: 2px solid #e0e0e0;
	border-radius: 40px;
	padding: 10px 18px;
	margin-bottom: 10px;
	transition: border-color .2s;
}
.sd-search-bar:focus-within { border-color: #1565c0; }
.sd-search-icon { font-size: 18px; margin-right: 10px; color: #999; }
#sd-search-input {
	flex: 1; border: none; outline: none;
	font-size: 15px; background: transparent;
}
.sd-search-clear {
	cursor: pointer; color: #aaa; font-size: 14px;
	display: none; padding: 2px 4px; border-radius: 50%;
}
.sd-search-clear:hover { color: #555; background: #f0f0f0; }
.sd-hint { font-size: 13px; color: #888; margin-bottom: 16px; min-height: 20px; }

/* ── Spinner ── */
.sd-spinner {
	display: inline-block; width: 14px; height: 14px;
	border: 2px solid #ccc; border-top-color: #1565c0;
	border-radius: 50%; animation: sd-spin .7s linear infinite;
	vertical-align: middle; margin-right: 6px;
}
.sd-spinner-lg { width: 32px; height: 32px; border-width: 3px; }
@keyframes sd-spin { to { transform: rotate(360deg); } }

/* ── Badges ── */
.sd-badge {
	display: inline-block; border-radius: 10px;
	padding: 2px 8px; font-size: 11px; font-weight: 600;
	margin-right: 4px; margin-top: 2px;
}
.sd-badge-green  { background: #e8f5e9; color: #2e7d32; }
.sd-badge-blue   { background: #e3f2fd; color: #1565c0; }
.sd-badge-red    { background: #ffebee; color: #c62828; }
.sd-badge-orange { background: #fff3e0; color: #e65100; }
.sd-badge-gray   { background: #f5f5f5; color: #555; }

/* ── Customer cards grid ── */
.sd-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	gap: 14px;
}
.sd-cust-card {
	display: flex; align-items: flex-start;
	background: #fff;
	border: 1px solid #e8e8e8;
	border-radius: 12px;
	padding: 16px;
	cursor: pointer;
	transition: transform .15s, box-shadow .15s, border-color .15s;
}
.sd-cust-card:hover {
	transform: translateY(-2px);
	box-shadow: 0 4px 16px rgba(0,0,0,.10);
	border-color: #1565c0;
}
.sd-avatar {
	width: 44px; height: 44px; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	color: #fff; font-weight: 700; font-size: 16px;
	flex-shrink: 0; margin-right: 14px;
}
.sd-cust-info { flex: 1; min-width: 0; }
.sd-cust-name { font-weight: 600; font-size: 14px; color: #1a1a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sd-cust-sub  { font-size: 12px; color: #888; margin: 2px 0 6px; }
.sd-cust-badges { }
.sd-cust-capital { font-size: 12px; color: #1565c0; font-weight: 600; margin-top: 6px; }
.sd-cust-arrow { font-size: 22px; color: #ccc; align-self: center; padding-left: 8px; }

/* ── Modal backdrop ── */
#sd-modal-backdrop {
	position: fixed; inset: 0;
	background: rgba(0,0,0,.45); backdrop-filter: blur(3px);
	z-index: 9999;
	display: flex; align-items: center; justify-content: center;
	padding: 16px;
}
#sd-modal {
	background: #fff;
	border-radius: 16px;
	width: 100%; max-width: 900px;
	max-height: 90vh;
	display: flex; flex-direction: column;
	box-shadow: 0 20px 60px rgba(0,0,0,.25);
	overflow: hidden;
}

/* ── Modal header ── */
#sd-modal-header {
	display: flex; align-items: center;
	padding: 20px 24px;
	border-bottom: 1px solid #f0f0f0;
	gap: 16px;
}
.sdm-avatar {
	width: 56px; height: 56px; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	color: #fff; font-weight: 700; font-size: 20px; flex-shrink: 0;
}
.sdm-title-block { flex: 1; min-width: 0; }
.sdm-title-block h3 { margin: 0 0 4px; font-size: 18px; font-weight: 700; color: #1a1a1a; }
#sdm-sub { font-size: 13px; color: #888; }
#sd-modal-close {
	background: none; border: none;
	font-size: 18px; color: #999; cursor: pointer;
	width: 32px; height: 32px; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	flex-shrink: 0;
}
#sd-modal-close:hover { background: #f5f5f5; color: #333; }

/* ── Mini stats ── */
#sdm-mini-stats {
	padding: 12px 24px;
	background: #fafafa;
	border-bottom: 1px solid #f0f0f0;
}
.sdm-ms-row {
	display: flex; gap: 0; flex-wrap: wrap;
}
.sdm-ms-item {
	flex: 1; min-width: 80px;
	text-align: center; padding: 6px 0;
}
.sdm-ms-num {
	display: block; font-size: 20px; font-weight: 700; color: #1565c0;
}
.sdm-ms-num.sdm-ms-red { color: #c62828; }
.sdm-ms-lbl {
	display: block; font-size: 11px; color: #888; margin-top: 2px;
}

/* ── Tabs ── */
#sdm-tabs {
	display: flex; padding: 0 16px;
	border-bottom: 1px solid #e8e8e8;
	background: #fff;
}
.sdm-tab {
	padding: 12px 16px;
	border: none; background: none;
	font-size: 13px; font-weight: 500; color: #888;
	cursor: pointer; border-bottom: 2px solid transparent;
	transition: color .15s, border-color .15s;
}
.sdm-tab:hover { color: #1565c0; }
.sdm-tab-active { color: #1565c0 !important; border-bottom-color: #1565c0 !important; }

/* ── Modal body ── */
#sdm-body {
	flex: 1; overflow-y: auto; padding: 0;
	min-height: 200px;
}
.sdm-loading {
	display: flex; align-items: center; justify-content: center;
	height: 200px;
}
.sdm-empty {
	padding: 40px; text-align: center; color: #aaa; font-size: 14px;
}

/* ── Table ── */
.sdm-table {
	width: 100%; border-collapse: collapse; font-size: 13px;
}
.sdm-table thead tr {
	background: #f5f7fa; border-bottom: 2px solid #e8e8e8;
}
.sdm-table th {
	padding: 10px 14px; text-align: left;
	font-weight: 600; color: #555; white-space: nowrap;
}
.sdm-table td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; }
.sdm-row { cursor: pointer; transition: background .12s; }
.sdm-row:hover { background: #f0f6ff; }
.sdm-num { text-align: right; font-variant-numeric: tabular-nums; }
.sdm-table code {
	background: #f5f5f5; padding: 2px 6px;
	border-radius: 4px; font-size: 12px; color: #444;
}

/* ── Status badges in table ── */
.sdm-status {
	display: inline-block; border-radius: 8px;
	padding: 2px 8px; font-size: 11px; font-weight: 600;
}
.sdm-status-green  { background: #e8f5e9; color: #2e7d32; }
.sdm-status-blue   { background: #e3f2fd; color: #1565c0; }
.sdm-status-orange { background: #fff3e0; color: #e65100; }
.sdm-status-yellow { background: #fffde7; color: #f57f17; }
.sdm-status-red    { background: #ffebee; color: #c62828; }
.sdm-status-purple { background: #f3e5f5; color: #6a1b9a; }
.sdm-status-gray   { background: #f5f5f5; color: #666; }

/* ── Modal footer ── */
#sdm-footer {
	padding: 14px 24px; border-top: 1px solid #f0f0f0;
	display: flex; gap: 10px; justify-content: flex-end;
}
.sdm-btn {
	padding: 7px 18px; border-radius: 6px;
	font-size: 13px; font-weight: 500; text-decoration: none;
	transition: background .15s, color .15s;
}
.sdm-btn-outline {
	border: 1.5px solid #1565c0; color: #1565c0; background: transparent;
}
.sdm-btn-outline:hover { background: #1565c0; color: #fff; }
		`;
		const $s = $('<style>').attr('id', '_sd_css').text(css);
		$('head').append($s);
	}
}
