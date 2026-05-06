# Policy Constraints

## Rule DR-5112
**Source:** 1. Robots must not enter Zone C after 10PM.

- **Action:** BLOCK
- **Severity:** HIGH
- **Conditions:**
  - time: after 10PM
- **Entities:** robot, Zone C

## Rule DR-E338
**Source:** Authorized personnel only are allowed in Zone A at all times.

- **Action:** ALLOW
- **Severity:** LOW
- **Conditions:**
  - zone: Zone A
- **Entities:** Zone A

## Rule DR-1F9A
**Source:** In case of emergency, all robots must stop immediately.

- **Action:** ALLOW
- **Severity:** CRITICAL
- **Entities:** robot

## Rule DR-685A
**Source:** Delivery robots may operate in Zone B between 8AM and 6PM.

- **Action:** ALERT
- **Severity:** LOW
- **Conditions:**
  - time: between 8AM
  - zone: Zone B
- **Entities:** robot, Zone B

## Rule DR-BF0E
**Source:** The robot must remain within the designated testing area.

- **Action:** ALLOW
- **Severity:** HIGH
- **Entities:** robot

## Rule DR-3D4E
**Source:** Any deviation from the perimeter will trigger an automatic stop.

- **Action:** ALERT
- **Severity:** LOW

## Rule DR-AB6D
**Source:** If the robot loses connection, it must sit down immediately.

- **Action:** ALLOW
- **Severity:** CRITICAL
- **Conditions:**
  - trigger: the robot loses connection
- **Entities:** robot

## Rule DR-252D
**Source:** Pressing the hardware E-STOP will cut power to motors.

- **Action:** ESCALATE
- **Severity:** LOW

## Rule DR-C014
**Source:** Periodic checks of the leg joints are required every 10 hours of operation.

- **Action:** ALLOW
- **Severity:** MEDIUM

## Rule DR-6DC0
**Source:** Ensure the battery is above 20% before starting a mission.

- **Action:** ALERT
- **Severity:** LOW

