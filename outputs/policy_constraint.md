# Policy Constraints

## Rule DR-7159
**Source:** The robot must remain within the designated testing area.

- **Action:** ALLOW
- **Severity:** HIGH
- **Entities:** robot

## Rule DR-D675
**Source:** Any deviation from the perimeter will trigger an automatic stop.

- **Action:** ALERT
- **Severity:** LOW

## Rule DR-348D
**Source:** If the robot loses connection, it must sit down immediately.

- **Action:** ALLOW
- **Severity:** CRITICAL
- **Conditions:**
  - trigger: the robot loses connection
- **Entities:** robot

## Rule DR-B79D
**Source:** Pressing the hardware E-STOP will cut power to motors.

- **Action:** ESCALATE
- **Severity:** LOW

## Rule DR-6069
**Source:** Periodic checks of the leg joints are required every 10 hours of operation.

- **Action:** ALLOW
- **Severity:** MEDIUM

## Rule DR-56D8
**Source:** Ensure the battery is above 20% before starting a mission.

- **Action:** ALERT
- **Severity:** LOW

