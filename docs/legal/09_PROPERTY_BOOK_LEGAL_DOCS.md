# 09 — Property Book / Owner Data

**Product:** Property Book (`property_registry_people`, `properties`) — source of truth for Meeting Core and access (`docs/stage1-ownership-book.md`).  
**Design intent:** align with ЗУЕС art. 7 concepts (shares, ideal parts, entities) — **not** a legal certification.

---

## A. Assessment

| Topic | Status / note |
|-------|----------------|
| Legal basis for storage | **LAWYER** — legal obligation of manager / L.I. / contract |
| Source of truth | Product: Book (not parallel meeting registry) |
| Who enters data | Complex admin (staff) |
| Who confirms accuracy | **MISSING** formal owner attestation UI |
| Update process | Admin edits; audit history **PARTIAL** |
| Ownership-change process | Soft / stub noted in stage docs — **PARTIAL** |
| Access permissions | Role-gated admin; owners see own cabinet |
| Former owner data | Deregistration fields exist — retention **LAWYER** |
| Co-owners | Supported in book model |
| Legal entities + manager | Stage 1 design |
| Tenants | Not primary book “owner” relation — **PARTIAL** elsewhere |
| Guests | Separate `guest_mode` |
| Minors | **NOT APPLICABLE / LAWYER** if ever stored |
| Proxies | Meeting proxies — not book ownership |

---

## B. Forms / declarations (candidates)

1. Admin accuracy warranty when importing Excel  
2. Owner contact update request form  
3. Ownership change packet (deed refs — **lawyer** what to store)  
4. Entity representative appointment  
5. Consent/notice when collecting phone/email beyond necessity  

---

## C. Risks

- Wrong book → wrong voting weights / invites (high legal risk).  
- ALSYD as processor must follow customer instructions; customer remains responsible for lawful registry content (**draft posture**).  

**Lawyer review:** YES before treating Book as “official condominium register.”
