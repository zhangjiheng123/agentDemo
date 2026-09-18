# Specifications

This directory is the source of truth for feature work.

Each phase should contain:

```text
spec.md      user problem, scope, behavior, and acceptance criteria
plan.md      architecture, data flow, and implementation decisions
tasks.md     small executable tasks
verify.md    commands, test cases, and known risks
```

The normal implementation loop is:

```text
spec -> plan -> tasks -> implementation -> verify -> interview notes
```

If code and specification disagree, stop and resolve the disagreement before extending the feature.
