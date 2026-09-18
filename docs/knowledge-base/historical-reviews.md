# Historical Review Patterns / 历史审查模式

## Redirect Target Was Accepted From Request Data / 用户输入重定向目标

An earlier review found a login callback that redirected directly to a request-provided `returnTo` value. The fix restricted redirects to application-relative paths and rejected protocol-relative or external URLs.

Lesson: user-controlled redirect destinations need explicit allowlisting. A route that merely checks for a non-empty string is not enough.

## Upstream Failure Was Treated As Success / 上游失败被当作成功

An earlier API client returned `response.json()` without checking `response.ok`. A downstream component interpreted the provider error body as a valid result and rendered broken UI.

Lesson: validate the transport-level success boundary before parsing a response as domain data.
