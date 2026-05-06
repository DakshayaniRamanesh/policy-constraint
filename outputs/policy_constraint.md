# Policy Constraints

## Rule DR-46CA
**Source:** The robot must remain within the designated testing area.

- **Action:** ALLOW
- **Severity:** HIGH
- **Entities:** robot

## Rule DR-57A7
**Source:** Any deviation from the perimeter will trigger an automatic stop.

- **Action:** ALERT
- **Severity:** LOW

## Rule DR-5431
**Source:** If the robot loses connection, it must sit down immediately.

- **Action:** ALLOW
- **Severity:** CRITICAL
- **Conditions:**
  - trigger: the robot loses connection
- **Entities:** robot

## Rule DR-7253
**Source:** Pressing the hardware E-STOP will cut power to motors.

- **Action:** ESCALATE
- **Severity:** LOW

## Rule DR-BD45
**Source:** Periodic checks of the leg joints are required every 10 hours of operation.

- **Action:** ALLOW
- **Severity:** MEDIUM

## Rule DR-E6A8
**Source:** Ensure the battery is above 20% before starting a mission.

- **Action:** ALERT
- **Severity:** LOW

