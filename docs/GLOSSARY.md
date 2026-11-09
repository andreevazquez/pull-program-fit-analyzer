# Glossary · Glosario

The Spanish UI is Mexican business Spanish. Supply chain terms that planners and buyers in Mexican plants use in English stay in English; general business terms are translated. The same glossary is used by the MLCC Alternate Finder. `test/i18n.mjs` fails if a banned translation (marked ✗) appears in `js/i18n/es.js`.

La interfaz en español usa español de negocios de México. Los términos de supply chain que planeadores y compradores usan en inglés en las plantas de México se quedan en inglés; los términos generales de negocio se traducen.

## Kept in English · Se quedan en inglés

| Term | Not | Note |
|---|---|---|
| VMI, SMI, CRP, Kanban, MRP | | Program names |
| safety stock | ✗ inventario de seguridad | |
| lead time (LT) | ✗ tiempo de entrega | |
| forecast | ✗ pronóstico | |
| PO, open PO | ✗ orden de compra | "colocar PO", "PO abierta" |
| MOQ | | |
| carrying cost | ✗ costo de mantener | |
| on hand | | |
| sell-in, sell-through | | Supplier impact view |
| E&O | | Excess and obsolete |
| OTD, EDI, SLA, EOL, PCN, DIO | | |
| Ramp-up | | Trend value ("Ramp" in English UI) |
| commodity | | |
| date code | | |
| scorecard, hub, 3PL | | |
| P&L | | |

## Translated · Se traducen

| English | Español |
|---|---|
| Executive (role) | Director |
| Manager (role) | Gerente |
| Planner (role) | Planeador |
| Policy | Política |
| Expedite | Expeditar |
| Place PO | Colocar PO |
| Flat / Declining (trend) | Estable / En declive |
| Target inventory | Inventario objetivo |
| Days of supply (DOS) | Días de inventario (DOS) |
| Excess | Exceso |
| Build-up | Reabastecimiento |
| Consignment transfer | Transferencia por consignación |
| Turns | Rotación |
| Working capital | Capital de trabajo |
| Gross / net | Bruto / neto |
| Value pipeline | Pipeline de valor |
| Cash bridge | Cómo cuadran los números de efectivo |
| Rollout waves | Olas de implementación |
| Supplier impact | Impacto en proveedores |
| Freshness claim | Reclamo de frescura |
| Internal aging | Envejecimiento interno |
| Exceptions inbox | Bandeja de excepciones |
| Data integrity | Integridad de datos |
| Blocked | Bloqueada |
| Escalate / Watch | Escalar / Vigilar |
| Critical / High / Medium / Low | Crítica / Alta / Media / Baja |

## Formatting · Formato

- Numbers and dates use `Intl` with `en-US` or `es-MX`. Both use `.` for decimals and `,` for thousands.
- Compact money: `$4.74M` in English, `$4.74 M` in Spanish.
- CSV exports, column headers and file formats stay in English in both languages, so a downloaded file opens the same way everywhere.
