# Policy Constraints

## Rule DR-E70C
**Source:** 1. Robots must not enter Zone C after 10PM.

- **Action:** BLOCK
- **Severity:** HIGH
- **Conditions:**
  - time: after 10PM
- **Entities:** robot, Zone C

## Rule DR-144B
**Source:** Authorized personnel only are allowed in Zone A at all times.

- **Action:** ALLOW
- **Severity:** LOW
- **Conditions:**
  - zone: Zone A
- **Entities:** Zone A

## Rule DR-D393
**Source:** In case of emergency, all robots must stop immediately.

- **Action:** ALLOW
- **Severity:** CRITICAL
- **Entities:** robot

## Rule DR-3CB7
**Source:** Delivery robots may operate in Zone B between 8AM and 6PM.

- **Action:** ALERT
- **Severity:** LOW
- **Conditions:**
  - time: between 8AM
  - zone: Zone B
- **Entities:** robot, Zone B

