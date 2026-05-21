# Entre ERP Seguros

Sistema de Gestão de Seguros para Moçambique, desenvolvido pela Entretech.
App Frappe/ERPNext para gestão completa do ciclo de vida de seguros: cotação → apólice → pagamento → sinistro → endosso.

---

## Requisitos

- Frappe v15 + ERPNext v15
- Python 3.10+
- `qrcode[pil]` e `Pillow` (instalados automaticamente pelo bench)

---

## Instalação

```bash
# 1. Obter a app
cd /home/frappe/frappe-bench
bench get-app https://github.com/entretech/entre_erp_seguros

# 2. Instalar na instância
bench --site [nome-do-site] install-app entre_erp_seguros

# 3. Migrar (cria DocTypes, custom fields, fixtures e dados de amostra)
bench --site [nome-do-site] migrate
```

A instalação executa automaticamente:
- Criação dos campos customizados no DocType **Customer** (BI, NUIT, Data de Nascimento, Género, Telefone, Endereço)
- Importação dos fixtures (Ramos, Templates de Factores de Risco, Workspace "Seguros")
- Criação dos produtos de amostra (Vida, Automóvel, Habitação, Funeral) com taxas base
- Registo dos formatos de impressão (Apólice de Seguro, Cotação de Seguro)

---

## Estrutura do Sistema

### Dados Mestres
| DocType | Descrição |
|---|---|
| **Insurance Branch** | Ramos de seguro (VIDA, AUTO, HABIT, FUN) |
| **Coverage Type** | Tipos de cobertura por ramo |
| **Risk Factor Template** | Templates de factores de risco por produto |
| **Insurance Product** | Produtos configurados pela seguradora |
| **Premium Rate Table** | Tabela actuarial de taxas por produto |

### Transacções
| DocType | Série | Descrição |
|---|---|---|
| **Insurance Quotation** | QT-.YYYY.-.##### | Cotação criada pelo operador |
| **Insurance Policy** | APL-.YYYY.-.##### | Apólice emitida (documento submissível) |
| **Premium Payment** | PAG-.YYYY.-.##### | Registo de pagamento de prémio |
| **Insurance Claim** | SIN-.YYYY.-.##### | Sinistro participado |
| **Policy Endorsement** | END-.YYYY.-.##### | Endosso/alteração à apólice |

---

## Fluxo Principal

```
1. Configurar Produto (Insurance Product + Premium Rate Table)
   |
2. Criar Cotação (Insurance Quotation)
   - Seleccionar cliente, produto, capital, prazo
   - Preencher factores de risco (formulário dinâmico)
   - Clicar "Calcular Prémio"
   |
3. Emitir Apólice
   - Clicar "Emitir Apólice" na cotação
   - Apólice criada em estado "Pendente de Pagamento"
   - QR Code de autenticidade gerado automaticamente
   |
4. Registar Pagamento (Premium Payment)
   - Submeter pagamento -> apólice activada automaticamente
   - Lançamento contabilístico criado no ERPNext
   |
5. Gestão em curso
   - Sinistros (Insurance Claim)
   - Endossos/alterações (Policy Endorsement)
   - Expiração automática via job diário
```

---

## Verificação de Autenticidade

As apólices emitem um QR Code que aponta para:

```
https://[seu-dominio]/verify?p=APL-YYYY-#####
```

Página pública (sem login) mostrando: estado, segurado, produto, vigência.

---

## Workspace

Após instalação, aceder ao workspace **Seguros** no menu principal do Frappe.

Atalhos: Cotações · Apólices · Pagamentos · Sinistros · Produtos

---

## Configuração Pós-Instalação

1. **Chart of Accounts** — Configurar a conta de prémios a receber e modos de pagamento (M-Pesa, e-Mola, etc.) em ERPNext para que os lançamentos contabilísticos sejam gerados automaticamente no pagamento.

2. **Tabela de Taxas** — Substituir as taxas de amostra pelas taxas actuariais reais em `Premium Rate Table`.

3. **Condições Gerais** — Adicionar o texto oficial das condições gerais e especiais em cada `Insurance Product`.

4. **Coberturas** — Configurar os tipos de cobertura (`Coverage Type`) e associá-los aos produtos.

---

## Dados de Amostra Instalados

| Item | Detalhe |
|---|---|
| Ramos | Vida/Crédito, Automóvel, Habitação, Funeral |
| Templates de Risco | VIDA (fumador, doença crónica, profissão de risco), AUTO (ano do veículo, uso, idade do condutor), HABITAÇÃO (material de construção, zona) |
| Produtos | Seguro de Vida Individual, Seguro Automóvel, Seguro de Habitação, Seguro Funeral |
| Taxas base | VIDA: 0.80-1.50% · AUTO: 2.00% · HABIT: 0.45% · FUNERAL: 1.20% |

---

## Publicado por

**Entretech** — info@entretech.co.mz
