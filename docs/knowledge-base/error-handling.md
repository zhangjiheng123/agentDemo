# Error Handling And API Boundaries / 错误处理与接口边界

## Check Failure Before Parsing / 解析前检查失败状态

When code calls an HTTP API, check the response status before parsing or returning the response body. Returning `response.json()` for a non-success status often leaks an upstream error payload into normal application control flow and hides the real failure boundary.

## Preserve Useful Error Context / 保留安全的错误上下文

Map provider or GitHub failures to safe, actionable application errors. Do not return credentials, raw authorization headers, full upstream payloads, or internal stack traces to the browser.

## Cancellation And Timeouts / 取消与超时

Long-running external operations should receive an AbortSignal and have a timeout. Cancellation should stop later workflow steps rather than merely hiding a loading indicator in the UI.
