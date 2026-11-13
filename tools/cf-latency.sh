#!/usr/bin/env bash
# Cloudflare 분석: 최근 24시간 Worker·Durable Object·D1 시간대별 처리 시간 (지역별 가능하면 지역별)
set -u
SINCE=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ); UNTIL=$(date -u +%Y-%m-%dT%H:%M:%SZ)
q() {
  jq -n --arg a "$CLOUDFLARE_ACCOUNT_ID" --arg s "$SINCE" --arg u "$UNTIL" --arg body "$1" \
    '{query: ("query($a:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){" + $body + "}}}"), variables: {a: $a, s: $s, u: $u}}' |
  curl -s https://api.cloudflare.com/client/v4/graphql -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' -d @-
}
echo "== Worker 시간대별 (UTC, 실제 처리 시간 ms)"
q 'w:workersInvocationsAdaptive(limit:200,filter:{datetime_geq:$s,datetime_leq:$u,scriptName:"yacht-dice-api"}){sum{requests errors} quantiles{wallTimeP50 wallTimeP99 cpuTimeP99} dimensions{datetimeHour status}}' |
  jq -r '.errors // empty, (.data.viewer.accounts[0].w // [] | map(select(.dimensions.status=="success")) | sort_by(.dimensions.datetimeHour)[] | "\(.dimensions.datetimeHour[11:13])시 요청 \(.sum.requests) 오류 \(.sum.errors) wall p50 \((.quantiles.wallTimeP50/1000)|floor)ms p99 \((.quantiles.wallTimeP99/1000)|floor)ms cpu p99 \((.quantiles.cpuTimeP99/1000)|floor)ms")'
echo "== Worker 지역별"
q 'w:workersInvocationsAdaptive(limit:50,filter:{datetime_geq:$s,datetime_leq:$u,scriptName:"yacht-dice-api",status:"success"}){sum{requests} quantiles{wallTimeP50 wallTimeP90 wallTimeP99} dimensions{coloCode}}' |
  jq -r '.errors // empty, (.data.viewer.accounts[0].w // [] | sort_by(-.sum.requests)[] | "\(.dimensions.coloCode) 요청 \(.sum.requests) p50 \((.quantiles.wallTimeP50/1000)|floor)ms p90 \((.quantiles.wallTimeP90/1000)|floor)ms p99 \((.quantiles.wallTimeP99/1000)|floor)ms")'
echo "== Durable Object(같이 하기) 시간대별"
q 'd:durableObjectsInvocationsAdaptiveGroups(limit:200,filter:{datetime_geq:$s,datetime_leq:$u}){sum{requests errors} quantiles{wallTimeP50} dimensions{datetimeHour}}' |
  jq -r '.errors // empty, (.data.viewer.accounts[0].d // [] | sort_by(.dimensions.datetimeHour)[] | "\(.dimensions.datetimeHour[11:13])시 요청 \(.sum.requests) 오류 \(.sum.errors)")'
echo "== D1 시간대별 (쿼리 ms)"
q 'd:d1AnalyticsAdaptiveGroups(limit:200,filter:{datetime_geq:$s,datetime_leq:$u}){sum{readQueries writeQueries} quantiles{queryBatchTimeMsP50 queryBatchTimeMsP90} dimensions{datetimeHour}}' |
  jq -r '.errors // empty, (.data.viewer.accounts[0].d // [] | sort_by(.dimensions.datetimeHour)[] | "\(.dimensions.datetimeHour[11:13])시 읽기 \(.sum.readQueries) 쓰기 \(.sum.writeQueries) p50 \(.quantiles.queryBatchTimeMsP50) p90 \(.quantiles.queryBatchTimeMsP90)")'
