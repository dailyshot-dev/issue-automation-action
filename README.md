# Dailyshot Issue Automation Action

Dailyshot 여러 repository에서 issue 처리 흐름을 공통으로 운영하기 위한 TypeScript GitHub Action입니다. Parent issue의 automation state comment를 상태 저장소로 사용하고, Claude Code Action 실행 준비, 결과 정리, dependency repository issue 생성을 담당합니다.

이 README는 AI agent가 대상 repository에 이 action을 적용할 때 따라야 하는 운영 계약입니다.

## 적용 대상

- `dailyshot-claude-plugin`
- `dailyshot-dbt`
- `aws-infra`
- 같은 방식의 issue 자동화가 필요한 Dailyshot repository

## 이 Repository 구성

- `action.yml`: custom action 입력, 출력, 실행 entrypoint
- `src/`: TypeScript source
- `dist/`: `pnpm build`로 생성하는 배포용 bundled action
- `.github/workflows/issue-claude-workflow.yml`: 대상 repository가 호출하는 reusable workflow
- `examples/`: repository별 `.github/issue-automation.yml` 예시
- `docs/workflow-flow.md`: workflow phase와 입출력 흐름

## 대상 Repository 적용 절차

1. `.github/workflows/issue-claude.yml` 파일을 추가합니다.
2. `.github/issue-automation.yml` 파일을 추가합니다.
3. `.github/ai/issue-agent-contract.md` 파일을 추가합니다.
4. Repository secrets를 설정합니다.
5. `workflow_dispatch`로 실제 issue number를 넣어 수동 실행합니다.
6. Parent issue에 automation state comment와 결과 comment가 생성되는지 확인합니다.

## Caller Workflow

대상 repository에는 아래 workflow를 추가합니다.

```yaml
name: Issue Claude Workflow

on:
  issues:
    types: [opened]
  workflow_dispatch:
    inputs:
      issue_number:
        required: true
        type: number
      force_ai:
        required: false
        default: false
        type: boolean

permissions:
  actions: read
  contents: write
  issues: write
  pull-requests: write

jobs:
  issue-automation:
    uses: dailyshot-dev/issue-automation-action/.github/workflows/issue-claude-workflow.yml@<commit-sha>
    with:
      issue_number: ${{ github.event.issue.number || inputs.issue_number }}
      force_ai: ${{ inputs.force_ai || false }}
      config_path: .github/issue-automation.yml
      agent_contract_path: .github/ai/issue-agent-contract.md
    secrets: inherit
```

`<commit-sha>`에는 이 repository의 배포 commit hash를 넣습니다. Reusable workflow를 쓰는 대상 repository는 workflow 파일 경로까지 포함해야 합니다.

Custom action phase를 직접 호출할 때는 아래 형식을 사용합니다.

```yaml
- name: Run issue automation phase
  uses: dailyshot-dev/issue-automation-action@<commit-sha>
  with:
    phase: intake
    github_token: ${{ github.token }}
```

## Required Secrets

- `CLAUDE_CODE_OAUTH_TOKEN`: Claude Code Action 실행 token
- `DAILYSHOT_DEPENDENCY_ISSUE_TOKEN`: dependency repository issue 생성 권한이 있는 token

`DAILYSHOT_DEPENDENCY_ISSUE_TOKEN`은 dependency repository에 `issues:write` 권한이 있어야 합니다. Secret이 없으면 workflow는 `github.token`을 사용합니다.

## Runner Gate

`issues` event에서는 issue 작성자의 `author_association`이 `OWNER`, `MEMBER`, `COLLABORATOR` 중 하나일 때 Claude runner job을 실행합니다. `workflow_dispatch`는 maintainer 수동 실행 경로입니다.

`phase=prepare`는 issue state를 읽고 실행 여부를 결정합니다.

| State | Claude runner 실행 |
| --- | --- |
| `triage` | 실행 |
| `working` | `force_ai=true`일 때 실행 |
| `needs_dependency` | `force_ai=true`일 때 실행 |
| `no_changes` | `force_ai=true`일 때 실행 |
| `needs_info` | 실행하지 않음 |
| `needs_maintainer` | 실행하지 않음 |
| `pr_created` | 실행하지 않음 |

## Issue State Comment

Action은 parent issue의 `<!-- dailyshot-issue-automation-state` marker comment를 상태 저장소로 사용합니다. Comment body에는 hidden JSON block과 사람이 읽을 수 있는 summary가 함께 들어갑니다.

저장되는 주요 필드:

| Field | 의미 |
| --- | --- |
| `status` | 현재 automation 상태 |
| `kind` | issue 종류 분류 결과 |
| `area` | issue 영역 분류 결과 |
| `dependencies` | 필요한 dependency key 목록 |
| `maintainerNeeded` | maintainer 확인 필요 여부 |
| `branch` | Claude runner가 사용할 branch |
| `prUrl` | 생성된 PR URL |
| `summary` | 현재 상태 요약 |
| `failureReason` | 실패 원인 |

## Config 파일

대상 repository의 `.github/issue-automation.yml`은 아래 schema를 사용합니다.

```yaml
runtime:
  dir: .github/ai/runtime
  issue_context_file: issue-context.md
  runner_result_file: runner-result.json

kind_rules:
  - value: bug
    patterns:
      - "bug|error|exception|fail"
  - value: feature
    patterns:
      - "feature|add|support"

default_kind: task

area_rules:
  - value: api
    patterns:
      - "api|endpoint|request|response"
  - value: data
    patterns:
      - "dbt|model|query|warehouse"

maintainer_patterns:
  - "secret|credential|permission|production"

dependencies:
  - key: dbt
    owner: dailyshot-dev
    repo: dailyshot-dbt
    marker: "<!-- dailyshot-dbt-sub-issue -->"
    auto_create: true
    patterns:
      - "dbt|model|warehouse"
    body_notes:
      - "Parent issue의 요구사항을 기준으로 dbt 변경 필요 여부를 확인합니다."
    title_prefix: "[{repo} #{issue_number}]"
```

### Config Field Rules

| Field | 필수 | 설명 |
| --- | --- | --- |
| `runtime.dir` | 아니오 | Claude runtime 파일을 쓰는 directory |
| `runtime.issue_context_file` | 아니오 | `phase=prepare`가 생성하는 issue context 파일명 |
| `runtime.runner_result_file` | 아니오 | Claude runner가 작성하는 result JSON 파일명 |
| `kind_rules[].value` | 예 | matching 시 저장할 `kind` 값 |
| `kind_rules[].patterns` | 아니오 | title/body에 적용할 정규식 목록 |
| `default_kind` | 아니오 | kind rule이 match되지 않을 때 사용할 값 |
| `area_rules[].value` | 예 | matching 시 저장할 `area` 값 |
| `area_rules[].patterns` | 아니오 | title/body에 적용할 정규식 목록 |
| `maintainer_patterns` | 아니오 | match되면 maintainer 확인 상태로 전환할 정규식 목록 |
| `dependencies[].key` | 예 | runner-result의 `needsIssues[]`와 매칭되는 key |
| `dependencies[].owner` | 예 | dependency issue를 생성할 repository owner |
| `dependencies[].repo` | 예 | dependency issue를 생성할 repository name |
| `dependencies[].marker` | 예 | parent issue comment에서 중복 생성을 막는 marker |
| `dependencies[].auto_create` | 아니오 | intake 단계에서 pattern match만으로 issue를 생성할지 여부 |
| `dependencies[].patterns` | 아니오 | auto create 판정에 사용하는 정규식 목록 |
| `dependencies[].body_notes` | 아니오 | dependency issue 본문에 추가할 처리 기준 |
| `dependencies[].title_prefix` | 아니오 | dependency issue title prefix template |

Template에서 사용할 수 있는 값:

- `{owner}`
- `{repo}`
- `{issue_number}`
- `{issue_title}`
- `{parent_url}`

## Agent Contract 파일

대상 repository의 `.github/ai/issue-agent-contract.md`에는 Claude runner가 지킬 repository별 작업 규칙을 작성합니다. 최소한 아래 내용을 포함합니다.

```markdown
# Issue Agent Contract

- 모든 issue/PR 설명은 한국어로 작성합니다.
- issue context의 automation state, title, body를 먼저 읽습니다.
- repository 변경으로 해결 가능한 범위만 수정합니다.
- commit, push, PR 생성은 workflow가 수행합니다.
- 직접 commit, push, PR 생성을 실행하지 않습니다.
- 작업 결과는 RUNNER_RESULT_PATH에 JSON으로 작성합니다.
```

## Runner Result Contract

Claude runner는 `RUNNER_RESULT_PATH`에 JSON을 작성합니다.

Repository 변경을 만들었으면 `create_pr`를 사용합니다.

```json
{
  "action": "create_pr",
  "commit_message": "fix: 이슈 처리 내용 요약",
  "pr_title": "이슈 처리 내용 요약",
  "problem": "무슨 문제가 있었는지",
  "root_cause": "왜 문제가 발생했는지",
  "solution": "어떻게 해결했는지",
  "validation": "어떻게 확인했는지",
  "summary": "변경 요약",
  "plannedChanges": [
    "변경한 파일과 동작 요약"
  ],
  "needsIssues": ["dbt"]
}
```

Repository 변경 없이 추가 정보가 필요하면 `needs_info`를 사용합니다.

```json
{
  "action": "needs_info",
  "summary": "재현 조건 또는 기대 동작이 필요합니다."
}
```

Repository 변경 없이 maintainer 확인이 필요하면 `needs_maintainer`를 사용합니다.

```json
{
  "action": "needs_maintainer",
  "summary": "권한 또는 운영 판단이 필요합니다."
}
```

Dependency repository 작업이 필요하면 `needsIssues`에 config의 `dependencies[].key` 값을 씁니다.

```json
{
  "action": "needs_maintainer",
  "summary": "dbt repository 작업이 필요합니다.",
  "needsIssues": ["dbt"]
}
```

변경이 필요하지 않으면 `no_changes`를 사용합니다.

```json
{
  "action": "no_changes",
  "summary": "현재 repository 상태에서 추가 변경이 필요하지 않습니다."
}
```

## Phase Responsibilities

| Phase | 책임 |
| --- | --- |
| `intake` | issue를 분류하고 state comment를 생성 또는 갱신합니다. `auto_create` dependency issue를 생성합니다. |
| `prepare` | Claude runner 실행 여부를 판단하고 `issue-context.md`를 생성합니다. |
| `prepare_pr_metadata` | runner-result를 읽고 commit message, PR title, PR body output을 생성합니다. |
| `finalize_pr` | PR 생성 이후 state comment와 결과 comment를 갱신합니다. |
| `finalize_no_changes` | repository 변경이 없을 때 runner-result action에 맞춰 state comment와 결과 comment를 갱신합니다. |
| `finalize_failure` | Claude 실행 또는 workflow orchestration 실패를 maintainer 확인 상태로 기록합니다. |
| `finalize_claude_action_failure` | Claude Code Action 실행 준비 실패를 maintainer 확인 상태로 기록합니다. |

## Dependency Issue Rules

- Parent issue title/body가 `dependencies[].patterns`에 match되고 `auto_create=true`이면 intake 단계에서 dependency issue를 생성합니다.
- Claude runner가 `needsIssues`에 dependency key를 쓰면 finalize 단계에서 dependency issue를 생성합니다.
- Parent issue comment에 `dependencies[].marker`가 있으면 같은 dependency issue를 중복 생성하지 않습니다.
- Dependency issue 생성 후 parent issue에 GitHub sub-issue 관계 연결을 시도합니다.
- Dependency issue 생성 실패는 parent issue comment와 automation state에 기록합니다.

## AI Agent 적용 Checklist

대상 repository에 적용할 때 이 순서로 처리합니다.

1. Repository 성격에 맞는 `examples/*.issue-automation.yml`을 선택합니다.
2. 선택한 예시를 대상 repository의 `.github/issue-automation.yml`로 복사하고 `kind_rules`, `area_rules`, `maintainer_patterns`, `dependencies`를 repository 용어에 맞춥니다.
3. `.github/ai/issue-agent-contract.md`를 생성하고 해당 repository의 테스트, lint, 금지 작업, PR 작성 규칙을 적습니다.
4. `.github/workflows/issue-claude.yml`을 추가하고 reusable workflow ref를 현재 배포 commit hash로 지정합니다.
5. 필요한 secrets가 설정되어 있는지 확인합니다.
6. `workflow_dispatch`로 실제 issue를 하나 실행합니다.
7. Parent issue에 `AI issue automation` comment가 생겼는지 확인합니다.
8. Claude runner가 변경을 만들면 branch, commit, PR이 생성되는지 확인합니다.
9. Dependency issue가 필요한 케이스에서는 parent issue comment의 marker와 dependency repository issue 생성 여부를 확인합니다.

## Development

이 action repository에서 작업할 때 사용합니다.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

전체 검증은 아래 명령으로 실행합니다.

```bash
pnpm check
```

`dist/index.js`는 `pnpm build`로 생성하며 release 전에 source 변경과 함께 commit합니다.

## Release Checklist

1. `pnpm check`를 통과시킵니다.
2. `dist/index.js`, `dist/index.js.map`, `dist/licenses.txt`, `dist/sourcemap-register.js`가 최신 build 결과인지 확인합니다.
3. `action.yml` input/output과 reusable workflow의 `with` 값이 일치하는지 확인합니다.
4. Example config가 `src/config.ts` schema와 일치하는지 확인합니다.
5. 배포 commit hash를 caller workflow의 ref로 사용합니다.
