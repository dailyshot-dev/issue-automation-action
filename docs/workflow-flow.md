# Issue Automation Workflow Flow

이 문서는 공용 issue automation workflow의 현재 실행 흐름과 각 단계의 입출력 파일을 정의합니다.

## Flow Diagram

```mermaid
flowchart TD
  A["Issue opened 또는 workflow_dispatch"] --> B["Reusable workflow 호출"]
  B --> C["issue-intake job"]
  C --> D["phase=intake"]
  D --> E["Load GitHub issue"]
  E --> F["Read .github/issue-automation.yml"]
  F --> G["title/body 기반 kind, area, dependency, maintainer 판정"]
  G --> I{"dependency issue 생성 대상 있음?"}
  I -->|"yes"| J["dependency repository issue 생성"]
  J --> K["Parent issue에 sub-issue 관계 연결"]
  K --> H["Parent issue state comment upsert"]
  I -->|"no"| H
  H --> L["intake 완료"]

  L --> M["claude-runner job"]
  M --> MA{"workflow_dispatch 또는 write 권한 작성자 issue?"}
  MA -->|"no"| MB["Claude runner job 종료"]
  MA -->|"yes"| N["phase=prepare"]
  N --> O["Load GitHub issue"]
  O --> P{"runner 실행 가능?"}
  P -->|"no"| Z["workflow 종료"]
  P -->|"yes"| Q["state status=working 저장"]
  Q --> R["Write .github/ai/runtime/issue-context.md"]
  R --> S["Create ai/issue-* branch"]
  S --> TA{"CLAUDE_CODE_OAUTH_TOKEN 설정됨?"}
  TA -->|"no"| DA["phase=finalize_claude_action_failure"]
  DA --> DB["state status=needs_maintainer 저장"]
  DB --> DD["Parent issue에 Claude Action failure comment 작성"]
  TA -->|"yes"| T["Run Claude Code Action"]
  T --> U["Read issue-context.md"]
  T --> V["Read .github/ai/issue-agent-contract.md"]
  T --> W["Repository files 수정"]
  T --> X["Write .github/ai/runtime/runner-result.json"]

  X --> Y{"runtime 파일 제외한 git status 변경 있음?"}
  Y -->|"yes"| AA["phase=prepare_pr_metadata"]
  AA --> AB["Read runner-result.json"]
  AB --> AC["commit_message, pr_title, pr_body outputs"]
  AC --> AD["runtime 파일 제외하고 git add, commit, push"]
  AD --> AE["gh pr create"]
  AE --> AF["phase=finalize_pr"]
  AF --> AG["Read runner-result.json"]
  AG --> AH["state status=pr_created 저장"]
  AH --> AI["needsIssues 기반 dependency issue 생성"]
  AI --> AK["Parent issue에 PR result comment 작성"]

  AD -->|"commit/push 실패"| EA["phase=finalize_failure"]
  AE -->|"PR 생성 실패"| EA
  EA --> EB["state status=needs_maintainer 저장"]
  EB --> ED["Parent issue에 workflow failure comment 작성"]

  Y -->|"no"| BA["phase=finalize_no_changes"]
  BA --> BB["Read runner-result.json"]
  BB --> BC{"action 값 확인"}
  BC -->|"needs_info"| BD["state status=needs_info 저장"]
  BC -->|"needs_* 또는 needsIssues"| BE["dependency issue 생성"]
  BC -->|"needs_maintainer 또는 결과 없음"| BF["state status=needs_maintainer 저장"]
  BC -->|"no_changes"| BG["상태 comment만 작성"]
  BD --> BH["Parent issue state comment upsert"]
  BE --> BH
  BF --> BH
  BG --> BH
  BH --> BI["Parent issue에 no-change result comment 작성"]

  T -->|"Claude 실패"| CA["phase=finalize_failure"]
  CA --> CB["state status=needs_maintainer 저장"]
  CB --> CD["Parent issue에 failure comment 작성"]
```

## Runtime Files

- `.github/issue-automation.yml`: caller repository별 classification, dependency routing, runtime path 설정
- `.github/ai/issue-agent-contract.md`: Claude Code agent가 따라야 하는 repository별 처리 계약
- `.github/ai/runtime/issue-context.md`: `phase=prepare`가 생성하고 Claude Code Action이 읽는 issue context
- `.github/ai/runtime/runner-result.json`: Claude Code Action이 쓰고 `prepare_pr_metadata`, `finalize_pr`, `finalize_no_changes`가 읽는 결과 JSON
- Runtime 파일은 repository 변경 감지와 commit 대상에서 제외합니다.

## Phase Responsibilities

| Phase | 주요 책임 | 주요 입력 | 주요 출력 |
| --- | --- | --- | --- |
| `intake` | issue state 정규화, dependency issue 초기 생성 | GitHub issue, `.github/issue-automation.yml` | state comment, dependency issue |
| `prepare` | Claude runner 실행 여부 판단, runtime context 생성 | GitHub issue, config, agent contract path | action outputs, `issue-context.md` |
| `prepare_pr_metadata` | PR 제목/본문/커밋 메시지 생성 | GitHub issue, `runner-result.json` | `commit_message`, `pr_title`, `pr_body` outputs |
| `finalize_pr` | PR 생성 이후 issue 상태 정리 | GitHub issue, PR URL, `runner-result.json` | state comment, result comment, dependency issue |
| `finalize_no_changes` | repository 변경이 없을 때 action별 후처리 | GitHub issue, `runner-result.json` | state comment, result comment, dependency issue |
| `finalize_failure` | Claude 실행 실패 처리 | GitHub issue | state comment, failure comment |
| `finalize_claude_action_failure` | Claude token 미설정 등 실행 준비 실패 처리 | GitHub issue, failure reason | state comment, failure comment |

## Dependency Issue Rules

- Dependency issue 생성 대상은 `.github/issue-automation.yml`의 `dependencies[]`로 정의합니다.
- `dependencies[].key`는 `runner-result.json`의 `needsIssues[]` 값과 일치해야 합니다.
- `dependencies[].auto_create`가 `true`이고 pattern이 title/body에 매칭되면 intake 단계에서 dependency issue 생성을 시도합니다.
- Parent issue comment 전체 페이지에 `dependencies[].marker`가 있으면 같은 dependency issue를 중복 생성하지 않습니다.
- Dependency issue 생성 후 parent issue에 GitHub sub-issue 관계 연결을 시도합니다.
- Dependency issue 생성 실패 시 parent issue에 실패 comment를 남기고 state status를 `needs_maintainer`로 저장합니다.

## Runner Execution Rules

- `issues` event에서는 issue 작성자의 `author_association`이 `OWNER`, `MEMBER`, `COLLABORATOR` 중 하나일 때만 Claude runner job을 실행합니다.
- `workflow_dispatch`는 maintainer가 수동으로 실행하는 경로로 간주해 Claude runner job을 실행할 수 있습니다.
- Claude runner 이후 변경 감지, PR metadata 생성, commit, push, PR 생성 단계가 실패하면 `phase=finalize_failure`로 parent issue state status를 `needs_maintainer`로 저장합니다.
