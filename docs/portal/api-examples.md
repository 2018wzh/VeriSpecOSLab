# Portal API examples

Use the CLI for normal student operations. The API example below is only for a local smoke
check; keep the returned cookies in memory and never commit them.

```sh
curl --fail-with-body --silent --show-error \\
  --cookie-jar /tmp/vos-portal.cookies \\
  --header 'content-type: application/json' \\
  --header "x-idempotency-key: $(uuidgen)" \\
  --data '{"username":"student","password":"student"}' \\
  https://localhost:8443/api/v1/auth/login
```

The student-facing connected flow is:

```sh
vos portal login https://portal.example.edu
vos portal whoami https://portal.example.edu
vos portal bind https://portal.example.edu PROJECT_ID
git add .vos/project.yaml .gitignore && git commit -m "[course][portal] Bind project"
vos portal run --watch
vos portal evidence RUN_ID --out .vos/downloads/RUN_ID
vos portal submit --watch
```

Bearer tokens are accepted for automation, but never use a placeholder token and never print a
real token in a log. Runner evidence is an internal typed endpoint, not a student upload API.

```sh
curl --fail-with-body --silent --show-error \\
  --cookie /tmp/vos-portal.cookies \\
  https://localhost:8443/api/v1/auth/me
```
