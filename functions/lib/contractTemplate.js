const TEMPLATE = `RESIDENTIAL DECK CONSTRUCTION AGREEMENT

This Agreement is made between Decked Out WNC Inc. ("Contractor") and
{{customerName}} ("Owner"), for the property located at {{address}}.

1. SCOPE OF WORK
{{scopeOfWork}}

2. CONTRACT PRICE
The total price for the work described above is {{bidAmount}}.

3. PAYMENT SCHEDULE
A deposit of {{depositPercent}}% ({{depositAmount}}) is due
upon signing this Agreement, before materials are ordered. The remaining balance
is due upon substantial completion of the work.

4. CHANGE ORDERS
Any change to the scope of work described above must be agreed to in writing by
both parties and may adjust the contract price and/or timeline accordingly.

5. TIMELINE
Contractor will provide an estimated start date and completion timeframe once
scheduling is confirmed. Actual timeline may be affected by weather, permitting,
and material availability.

6. PERMITS
Contractor is responsible for obtaining any building permits required for this
project.

7. WARRANTY
Contractor warrants its workmanship for a period of one (1) year from the date
of substantial completion. Manufacturer warranties on materials, where
applicable, are passed through to Owner.

8. INSURANCE
Contractor carries general liability insurance and will provide proof of
coverage upon request.

9. TERMINATION
Either party may terminate this Agreement for material breach upon written
notice. Owner remains responsible for payment for work completed and materials
already ordered as of the date of termination.

10. GOVERNING LAW
This Agreement is governed by the laws of the State of North Carolina.

11. ENTIRE AGREEMENT
This document constitutes the entire agreement between the parties and
supersedes all prior discussions regarding this project.

Accepted and agreed:

Owner: ____________________________  Date: ______________
       {{customerName}}

Contractor: Decked Out WNC Inc.       Date: {{sentDate}}`;

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function fillContractTemplate({ customerName, address, scopeOfWork, bidAmount, depositPercent, sentDate }) {
  const depositAmount = bidAmount * (depositPercent / 100);
  return TEMPLATE
    .replaceAll("{{customerName}}", customerName)
    .replaceAll("{{address}}", address)
    .replaceAll("{{scopeOfWork}}", scopeOfWork)
    .replaceAll("{{bidAmount}}", formatCurrency(bidAmount))
    .replaceAll("{{depositPercent}}", String(depositPercent))
    .replaceAll("{{depositAmount}}", formatCurrency(depositAmount))
    .replaceAll("{{sentDate}}", sentDate);
}
