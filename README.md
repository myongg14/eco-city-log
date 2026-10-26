# 에코시티 기록장

고2 「실제 기능을 갖춘 친환경 도시 모형」 프로젝트의 활동 기록 사이트입니다.
GitHub Pages(화면)와 Supabase(데이터베이스·로그인)로 돌아가며, 모두 무료 요금제로 씁니다.
카톡방에 사이트 주소를 올리면 각자 아이디와 비밀번호만으로 들어올 수 있어요.

## 처음 한 번만 하는 설정 (관리자)

### 1. 데이터베이스 만들기
1. Supabase 대시보드 → 왼쪽 메뉴 **SQL Editor** → **New query**
2. `supabase/01_foundation.sql` 파일 내용을 전부 복사해 붙여 넣고 **Run**
3. 맨 아래 결과에 `33`이 나오면 성공이에요. (학생 21 + 예비 10 + admin + teacher)

여러 번 실행해도 계정이 중복으로 생기지 않아요.

### 2. 아무나 가입하지 못하게 막기
**Authentication → Sign In / Providers**(또는 Settings)에서 **Allow new users to sign up** 을 끕니다.
계정은 위 SQL과 관리 화면에서만 만들어요.

### 3. 사이트 공개하기
GitHub 저장소 → **Settings → Pages** → Source를 **Deploy from a branch**, Branch를 **main / (root)** 로 두고 Save.
1~2분 뒤 `https://myongg14.github.io/eco-city-log/` 에서 열립니다. 이 주소를 카톡방에 올리면 돼요.

## 계정

| 구분 | 아이디 | 인원 |
| --- | --- | --- |
| 1팀 제로 에너지 하우스 | team1-1 ~ team1-4 | 4 |
| 2팀 배터리(ESS·스마트그리드) | team2-1 ~ team2-2 | 2 |
| 3팀 쓰레기장(바이오 에너지) | team3-1 | 1 |
| 4팀 친환경 에너지 발전 설비 | team4-1 | 1 |
| 5팀 LiDAR·딥러닝 자율주행 | team5-1 ~ team5-4 | 4 |
| 6팀 전력 시스템 안전·효율 | team6-1 ~ team6-3 | 3 |
| 7팀 도시 계획 | team7-1 ~ team7-6 | 6 |
| 예비 8팀·9팀 (처음엔 꺼짐) | team8-1 ~ team8-5, team9-1 ~ team9-5 | 10 |
| 관리자 | admin | 1 |
| 선생님 | teacher | 1 |

- 처음 비밀번호는 모두 `12345678`이고, 첫 로그인 때 새 비밀번호로 바꿔야 사이트를 쓸 수 있어요.
- 비밀번호를 5번 틀리면 10분 동안 잠겨요. 관리 화면에서 바로 풀 수 있어요.
- 비밀번호를 잊은 사람은 관리 화면에서 **비번 초기화**를 누르면 `12345678`로 돌아가요.
- 예비 팀은 관리 화면 **팀 관리**에서 켜야 로그인할 수 있어요.

## 보안 약속
- Supabase의 **service_role 키, Secret 키(sb_secret_…), Database 비밀번호**는 이 저장소, 코드, 채팅 어디에도 넣지 않아요.
- 코드에 들어간 `sb_publishable_…` 키는 공개돼도 괜찮은 키예요. 실제 보호는 데이터베이스의 RLS 규칙과 함수 권한이 맡아요.

## 문제가 생기면
- **아이디·비밀번호가 맞는데 로그인이 안 돼요**: Supabase가 `@ecocity.invalid` 형식의 가짜 이메일을 거부할 수 있어요.
  `js/config.js`의 `LOGIN_EMAIL_DOMAIN`과 SQL의 `private.login_email` 함수에서 도메인을 같은 값(예: `ecocity.example.com`)으로 바꾼 뒤,
  SQL Editor에서 아래를 실행하세요.
  ```sql
  update auth.users set email = replace(email, '@ecocity.invalid', '@새도메인');
  update auth.identities set identity_data = jsonb_set(identity_data, '{email}',
    to_jsonb(replace(identity_data->>'email', '@ecocity.invalid', '@새도메인')));
  ```
- **사이트가 갑자기 안 열려요**: Supabase 무료 프로젝트는 1주일 넘게 아무도 안 쓰면 일시 정지돼요. 대시보드에서 **Restore project** 를 누르면 돼요.
- **화면이 예전 그대로예요**: 새로고침(모바일은 앱을 닫았다 열기)을 해 보세요.

## 폴더 구조
```
index.html            화면 틀
css/style.css         디자인
js/config.js          Supabase 주소와 공개 키, 마감일
js/api.js             Supabase 연결
js/app.js             화면 이동과 로그인 상태 관리
js/views/*.js         각 화면
js/vendor/supabase.js Supabase 라이브러리 (supabase-js 2.118.0)
supabase/*.sql        데이터베이스 만드는 SQL (순서대로 실행)
```
