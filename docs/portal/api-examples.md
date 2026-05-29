# API Examples

Login:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8080/api/v1/auth/login `
  -ContentType application/json `
  -Body '{"username":"student","password":"student"}'
```

List projects:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:8080/api/v1/projects `
  -Headers @{ Authorization = "Bearer demo-student" }
```

Upload evidence:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8080/api/v1/internal/evidence `
  -ContentType application/json `
  -Body '{
    "project_id":"PROJECT_ID",
    "commit_sha":"abc123",
    "records":[{
      "kind":"test",
      "suite":"memory",
      "case_name":"page_allocator_tests",
      "result":"pass",
      "metrics":{"seed":17}
    }]
  }'
```

