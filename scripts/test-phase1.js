#!/usr/bin/env node

/**
 * Phase 1 Integration Test
 * Tests the Multi-Agent trading flow without requiring a real wallet
 */

const BASE_URL = 'http://localhost:3000';

async function testHealthCheck() {
  console.log('\n🔍 Test 1: Health Check');
  const res = await fetch(`${BASE_URL}/api/health`);
  const data = await res.json();

  if (data.status === 'ok' && data.rpc === true) {
    console.log('✅ Health check passed');
    console.log(`   Latest ledger: ${data.latestLedger}`);
    return true;
  }
  console.log('❌ Health check failed');
  return false;
}

async function testRouterAgent() {
  console.log('\n🔍 Test 2: Router Agent - Intent Classification');

  const testCases = [
    { input: "What's the current TKNA price?", expected: "analytics" },
    { input: "Swap 100 TKNA for TKNB", expected: "trading" },
    { input: "Is this pool safe?", expected: "security" },
  ];

  for (const testCase of testCases) {
    const res = await fetch(`${BASE_URL}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: testCase.input }],
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let routerOutput = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'router') {
            routerOutput = evt.output;
            break;
          }
        } catch {}
      }

      if (routerOutput) break;
    }

    if (routerOutput && routerOutput.intent === testCase.expected) {
      console.log(`✅ "${testCase.input}" → ${routerOutput.intent}`);
    } else {
      console.log(`❌ "${testCase.input}" → expected ${testCase.expected}, got ${routerOutput?.intent}`);
      return false;
    }
  }

  return true;
}

async function testAnalyticsAgent() {
  console.log('\n🔍 Test 3: Analytics Agent - Pool Stats Query');

  const res = await fetch(`${BASE_URL}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: "What's the current pool reserves?" }],
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let toolCalls = [];
  let hasText = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;

      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'tool_use') {
          toolCalls.push(evt.name);
        } else if (evt.type === 'text' && evt.delta.trim()) {
          hasText = true;
        }
      } catch {}
    }
  }

  if (toolCalls.includes('get_pool_stats') && hasText) {
    console.log('✅ Analytics agent called get_pool_stats and returned text');
    console.log(`   Tools called: ${toolCalls.join(', ')}`);
    return true;
  }

  console.log('❌ Analytics agent test failed');
  return false;
}

async function testTradingAgentSimulation() {
  console.log('\n🔍 Test 4: Trading Agent - Swap Simulation');

  const res = await fetch(`${BASE_URL}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: "Simulate swapping 10 TKNA for TKNB" }],
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let toolCalls = [];
  let hasSimulateSwap = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;

      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'tool_use') {
          toolCalls.push(evt.name);
          if (evt.name === 'simulate_swap') {
            hasSimulateSwap = true;
          }
        }
      } catch {}
    }
  }

  if (hasSimulateSwap) {
    console.log('✅ Trading agent called simulate_swap');
    console.log(`   Tools called: ${toolCalls.join(', ')}`);
    return true;
  }

  console.log('❌ Trading agent simulation test failed');
  return false;
}

async function testSecurityAgent() {
  console.log('\n🔍 Test 5: Security Agent - Risk Analysis');

  const res = await fetch(`${BASE_URL}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: "Check if there's any suspicious activity in the pool" }],
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let toolCalls = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;

      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'tool_use') {
          toolCalls.push(evt.name);
        }
      } catch {}
    }
  }

  const hasSecurityTools = toolCalls.some(t =>
    t === 'scan_recent_anomalies' ||
    t === 'analyze_liquidity_depth' ||
    t === 'check_price_impact'
  );

  if (hasSecurityTools) {
    console.log('✅ Security agent called risk analysis tools');
    console.log(`   Tools called: ${toolCalls.join(', ')}`);
    return true;
  }

  console.log('❌ Security agent test failed');
  return false;
}

async function runTests() {
  console.log('🚀 Starting Phase 1 Integration Tests\n');
  console.log('=' .repeat(60));

  const results = [];

  try {
    results.push(await testHealthCheck());
    results.push(await testRouterAgent());
    results.push(await testAnalyticsAgent());
    results.push(await testTradingAgentSimulation());
    results.push(await testSecurityAgent());
  } catch (err) {
    console.error('\n❌ Test suite failed with error:', err.message);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Results:');
  console.log(`   Passed: ${results.filter(r => r).length}/${results.length}`);
  console.log(`   Failed: ${results.filter(r => !r).length}/${results.length}`);

  if (results.every(r => r)) {
    console.log('\n✅ All tests passed! Ready for Phase 2 implementation.\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Please review the output above.\n');
    process.exit(1);
  }
}

runTests();
