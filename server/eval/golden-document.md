# Wrenfield Ledger — Product Overview

## Overview

Wrenfield Ledger is a small-business expense tracking and reconciliation platform, built by Wrenfield Software Ltd. and first released in March 2019. The product was founded by Priya Ashworth and Callum Ostrander after both left careers in traditional accounting to build tooling for freelancers and small teams. As of this document's writing, Wrenfield Ledger serves approximately 41,000 active business accounts.

The platform's guiding design principle is "every number traces to a receipt" — the founders built the product specifically to eliminate reconciliation disputes by making every transaction's supporting evidence a single click away.

## Core Features

**Receipt Vault.** Every expense entry requires an attached receipt image or PDF before it can be marked reconciled. The Receipt Vault uses on-device OCR to extract vendor name, date, and amount automatically, with a claimed extraction accuracy of 96.4% on printed receipts and 88.1% on handwritten ones.

**Ledger Threads.** Instead of a flat transaction list, related expenses (e.g., a multi-leg business trip) can be grouped into a "Ledger Thread," which rolls up into a single reconciliation entry. A Ledger Thread can contain up to 60 individual transactions.

**Quarterly Snapshot.** At the end of each fiscal quarter, Wrenfield Ledger generates a Quarterly Snapshot report: a single PDF summarizing spend by category, flagged anomalies, and a reconciliation completion percentage. Snapshot generation typically takes under four minutes for accounts with fewer than 10,000 transactions.

**Anomaly Flags.** The platform flags transactions that deviate more than 3 standard deviations from a vendor's historical spend pattern, or any transaction over $2,500 without an attached receipt.

## Pricing

Wrenfield Ledger offers three tiers: Starter (free, capped at 50 transactions per month and 1 user seat), Team ($34/month, up to 10 user seats and 5,000 transactions per month), and Ledger Pro ($89/month, unlimited user seats and transactions, plus priority Anomaly Flag review). All tiers include the Receipt Vault and Quarterly Snapshot features; Ledger Threads are exclusive to Team and Ledger Pro.

## Team & History

Wrenfield Software Ltd. is headquartered in Leeds, United Kingdom, with a secondary engineering office opened in Porto, Portugal in 2022. The company raised a £2.1 million seed round in 2019 led by Marrow Street Capital, followed by a £9.6 million Series A in 2021 led by Kestrel Bridge Partners. As of this document, the company employs 47 people. Priya Ashworth serves as CEO; Callum Ostrander serves as Head of Product.

## Technical Architecture

The backend is built on a Kotlin/Spring Boot service layer backed by PostgreSQL, with receipt OCR handled by a dedicated Rust microservice called `parchment`. The frontend is a Vue 3 single-page application. Wrenfield Ledger is hosted entirely on-premises in two UK data centers rather than a public cloud provider, a decision the engineering team has attributed to data-residency requirements from early enterprise customers.

## Support & SLA

Team and Ledger Pro accounts get access to live chat support with a target first-response time of 15 minutes during UK business hours (9am-6pm GMT, Monday-Friday). Starter accounts are limited to email support with a 3-business-day response target. There is no 24/7 support tier currently offered on any plan.
