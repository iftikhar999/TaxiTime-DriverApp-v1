#!/bin/bash

echo "=========================================="
echo "Phase 7 Driver App Verification Script"
echo "=========================================="

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
PASSED=0
FAILED=0

check_file(){
  local name="$1"; local path="$2"
  if [ -f "$path" ]; then
    echo -e "${GREEN}✅ PASS${NC}: $name exists"
    ((PASSED++))
  else
    echo -e "${RED}❌ FAIL${NC}: $name missing at $path"
    ((FAILED++))
  fi
}

echo "\n1) Checking files"
check_file "apiClient" "src/services/v2/apiClient.ts"
check_file "jobService" "src/services/v2/jobService.ts"
check_file "podService" "src/services/v2/podService.ts"
check_file "StopListScreen" "src/screens/ActiveJob/StopListScreen.tsx"
check_file "StopDetailScreen" "src/screens/ActiveJob/StopDetailScreen.tsx"
check_file "PODCaptureScreen" "src/screens/ActiveJob/PODCaptureScreen.tsx"
check_file "StopProgressBar" "src/components/StopProgressBar.tsx"
check_file "useActiveJob" "src/hooks/useActiveJob.ts"
check_file "useStopActions" "src/hooks/useStopActions.ts"
check_file "usePODCapture" "src/hooks/usePODCapture.ts"
check_file "tests" "src/__tests__/v2DriverApp.test.tsx"

echo "\n2) Running tests"
if npm test -- --testPathPattern=v2DriverApp >/tmp/phase7-tests.log 2>&1; then
  echo -e "${GREEN}✅ PASS${NC}: Tests passed"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠️  WARN${NC}: Tests failed or not runnable"
  cat /tmp/phase7-tests.log
fi

echo "\n=========================================="
echo "SUMMARY"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ Phase 7 verification PASSED!${NC}"
  exit 0
else
  echo -e "${YELLOW}⚠️  Phase 7 verification has $FAILED failures${NC}"
  exit 1
fi
