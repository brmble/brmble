# Task 10 report: End-to-end compatibility, reliability, and acceptance verification

## Summary

- Added server integration coverage for still PNG/WebP acceptance, unsupported/corrupt/oversized/animated rejection, no-state-write rejection behavior, upload/select/delete fallback, reconnect persistence, and auth capability failure modes.
- Extended the shared integration factory with typed repositories, Alice's seeded user id, and a controllable Matrix app-service fake for gallery room creation, joins, media downloads, state events, and redactions.
- Hardened image validation so recognized but undecodable PNG/WebP containers report invalid-image errors, while APNG/WebP animation markers are rejected even when codec frame reporting is incomplete.
- Added frontend acceptance coverage for saved custom selections during metadata loading, 100-entry lazy thumbnail/full-atlas loading, persistent atlas cache reuse and protected LRU eviction, wrong-room events, wrong-gallery fallback, remote custom display, and legacy built-in delivery.
- Documented custom companion configuration, upload limits, still-image restrictions, 8 x 9 sheet guidance, metadata-only sync, lazy media loading, 100 MiB persistent cache behavior, and deletion/media-retention caveats.
- Aligned LiveKit/auth integration tests with the shared factory's seeded Alice user so default-certificate session mappings reflect the actual fixture account.

## Verification

- `dotnet test tests\Brmble.Server.Tests\Brmble.Server.Tests.csproj --filter "FullyQualifiedName~CustomCompanionIntegrationTests|FullyQualifiedName~CustomCompanionImageValidatorTests|FullyQualifiedName~CustomCompanionEndpointsTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"`
  - PASS: 41 tests.
- `npm.cmd run test -- src/App.customCompanion.test.tsx src/hooks/useCustomCompanionGallery.test.tsx src/components/SettingsModal/customCompanions/CustomCompanionUploadDialog.test.tsx`
  - PASS: 3 files, 51 tests.
- `dotnet test tests\Brmble.Server.Tests\Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclAdminEndpointTests|FullyQualifiedName~ChannelRequestEndpointTests|FullyQualifiedName~AvatarSourceTests|FullyQualifiedName~ChannelChatAccessEndpointTests|FullyQualifiedName~LiveKitEndpointsTests|FullyQualifiedName~LiveKitTokenTests|FullyQualifiedName~AuthTokenTests"`
  - PASS: 56 tests.
- `npm.cmd run test`
  - PASS: 111 files, 1,311 tests.
- `npm.cmd run type-check`
  - PASS.
- `npm.cmd run build`
  - PASS.
- `dotnet test`
  - PASS: MumbleVoiceEngine 99 tests, Audio 73 tests, Client 281 tests, Server 573 tests.
- `dotnet build`
  - PASS: solution build succeeded with 0 warnings and 0 errors. This required escalation because the sandbox could not read the local Windows SDK metadata folder.

## Remaining

- Perform or explicitly defer the manual two-client visual checks; Classic/Retro screenshots are still unavailable in this session because the browser-control Node REPL tooling was not exposed and Playwright is not installed locally.
- Request review before marking Task 10 complete.
