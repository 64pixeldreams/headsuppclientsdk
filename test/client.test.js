import assert from 'node:assert/strict';
import test from 'node:test';

import { createHeadsUpClient, HeadsUpApiError } from '../src/index.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    async text() {
      return JSON.stringify(body);
    },
  };
}

function textResponse(text, status = 200, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      return text;
    },
  };
}

function createFunctionClient(responseFactory) {
  const calls = [];
  const client = createHeadsUpClient({
    baseUrl: 'https://headsupp.example',
    apiKey: 'hu_api_test',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return responseFactory(url, init, calls.length - 1);
    },
  });
  return { client, calls };
}

function functionEnvelope(resourceKey, resourceValue) {
  return jsonResponse({
    success: true,
    data: {
      ok: true,
      [resourceKey]: resourceValue,
    },
  });
}

test('calls control-plane actions and unwraps resources', async () => {
  const { client, calls } = createFunctionClient(() =>
    functionEnvelope('workspace', { workspace_id: 'ws_demo', name: 'Demo' }),
  );

  const workspace = await client.createWorkspace({ name: 'Demo' });

  assert.equal(workspace.workspace_id, 'ws_demo');
  assert.equal(calls[0].url, 'https://headsupp.example/api/function');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer hu_api_test');
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'admin.createWorkspace', payload: { name: 'Demo' } });
});

test('supports getChannel and updateChannel wrappers', async () => {
  const { client, calls } = createFunctionClient(() =>
    functionEnvelope('channel', {
      channel_id: 'ch_demo',
      name: 'Demo Channel',
      metadata: { forecast_id: 'fc_123' },
    }),
  );

  const channel = await client.getChannel({ workspace_id: 'ws_demo', channel_id: 'ch_demo' });
  const updated = await client.updateChannel({
    workspace_id: 'ws_demo',
    channel_id: 'ch_demo',
    metadata: { forecast_id: 'fc_456' },
  });

  assert.equal(channel.channel_id, 'ch_demo');
  assert.equal(updated.metadata.forecast_id, 'fc_123');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: 'admin.getChannel',
    payload: { workspace_id: 'ws_demo', channel_id: 'ch_demo' },
  });
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    action: 'admin.updateChannel',
    payload: { workspace_id: 'ws_demo', channel_id: 'ch_demo', metadata: { forecast_id: 'fc_456' } },
  });
});

test('disableSubscriber and deleteSubscriber unwrap subscriber resources', async () => {
  const responses = [
    functionEnvelope('subscriber', { subscriber_id: 'sub_1', enabled: 0 }),
    functionEnvelope('subscriber', { subscriber_id: 'sub_1' }),
  ];
  const { client, calls } = createFunctionClient((_url, _init, idx) => responses[idx]);

  const disabled = await client.disableSubscriber({
    workspace_id: 'ws_demo',
    channel_id: 'ch_demo',
    subscriber_id: 'sub_1',
  });
  const deleted = await client.deleteSubscriber({
    workspace_id: 'ws_demo',
    channel_id: 'ch_demo',
    email: 'martin@example.com',
    mode: 'alert',
  });

  assert.equal(disabled.subscriber_id, 'sub_1');
  assert.equal(deleted.subscriber_id, 'sub_1');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: 'admin.disableSubscriber',
    payload: { workspace_id: 'ws_demo', channel_id: 'ch_demo', subscriber_id: 'sub_1' },
  });
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    action: 'admin.deleteSubscriber',
    payload: { workspace_id: 'ws_demo', channel_id: 'ch_demo', email: 'martin@example.com', mode: 'alert' },
  });
});

test('maps wrapper methods to expected action names and unwraps resources', async () => {
  const responses = [
    functionEnvelope('channel_contract', { channel_contract_id: 'cc_1' }),
    functionEnvelope('channel_contract', { channel_contract_id: 'cc_2' }),
    jsonResponse({ success: true, data: { ok: true, alerts: [{ alert_id: 'alert_1' }], metadata: { as_of: 'now' } } }),
    functionEnvelope('watch_state', { watch_id: 'watch_1', last_status: 'warning' }),
    functionEnvelope('action_control', { action_id: 'ac_1', action_type: 'snooze' }),
    functionEnvelope('action_control', { action_id: 'ac_2', action_type: 'mute' }),
    functionEnvelope('action_control', { action_id: 'ac_3', action_type: 'resume' }),
    functionEnvelope('action_control', { action_id: 'ac_4', action_type: 'ignore' }),
  ];
  const { client, calls } = createFunctionClient((_url, _init, idx) => responses[idx]);

  const createdContract = await client.createChannelContract({ workspace_id: 'ws_demo', channel_id: 'ch_demo' });
  const updatedContract = await client.updateChannelContract({
    workspace_id: 'ws_demo',
    channel_id: 'ch_demo',
    channel_contract_id: 'cc_1',
  });
  const alertList = await client.listChannelAlerts({ workspace_id: 'ws_demo', channel_id: 'ch_demo' });
  const watchState = await client.getWatchState({ workspace_id: 'ws_demo', channel_id: 'ch_demo', watch_id: 'watch_1' });
  const snooze = await client.snoozeWatch({ workspace_id: 'ws_demo', channel_id: 'ch_demo', watch_id: 'watch_1' });
  const mute = await client.muteWatch({ workspace_id: 'ws_demo', channel_id: 'ch_demo', watch_id: 'watch_1' });
  const resume = await client.resumeWatch({ workspace_id: 'ws_demo', channel_id: 'ch_demo', watch_id: 'watch_1' });
  const ignore = await client.ignoreAlert({ workspace_id: 'ws_demo', channel_id: 'ch_demo', alert_id: 'alert_1' });

  assert.equal(createdContract.channel_contract_id, 'cc_1');
  assert.equal(updatedContract.channel_contract_id, 'cc_2');
  assert.equal(alertList.alerts[0].alert_id, 'alert_1');
  assert.equal(watchState.watch_id, 'watch_1');
  assert.equal(snooze.action_type, 'snooze');
  assert.equal(mute.action_type, 'mute');
  assert.equal(resume.action_type, 'resume');
  assert.equal(ignore.action_type, 'ignore');

  const actions = calls.map((call) => JSON.parse(call.init.body).action);
  assert.deepEqual(actions, [
    'admin.createChannelContract',
    'admin.updateChannelContract',
    'admin.listChannelAlerts',
    'admin.getWatchState',
    'admin.snoozeWatch',
    'admin.muteWatch',
    'admin.resumeWatch',
    'admin.ignoreAlert',
  ]);
});

test('returns undefined for empty successful response body', async () => {
  const { client } = createFunctionClient(() => textResponse('', 200, 'OK'));
  const result = await client.createWorkspace({ name: 'Demo' });
  assert.equal(result, undefined);
});

test('throws useful API errors for invalid JSON response', async () => {
  const { client } = createFunctionClient(() => textResponse('not-json', 200, 'OK'));
  await assert.rejects(() => client.createWorkspace({ name: 'Demo' }), (error) => {
    assert.equal(error instanceof HeadsUpApiError, true);
    assert.equal(error.code, 'INVALID_JSON_RESPONSE');
    assert.equal(error.status, 200);
    assert.equal(error.response, 'not-json');
    return true;
  });
});

test('throws useful API errors for non-2xx JSON error response', async () => {
  const { client } = createFunctionClient(() =>
    jsonResponse(
      {
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'Missing permission.', status: 403 },
      },
      403,
    ),
  );

  await assert.rejects(() => client.createWorkspace({ name: 'Demo' }), (error) => {
    assert.equal(error instanceof HeadsUpApiError, true);
    assert.equal(error.code, 'HTTP_ERROR');
    assert.equal(error.status, 403);
    assert.deepEqual(error.response.error, {
      code: 'PERMISSION_DENIED',
      message: 'Missing permission.',
      status: 403,
    });
    return true;
  });
});

test('throws useful API errors', async () => {
  const { client } = createFunctionClient(() =>
    jsonResponse({
      success: false,
      error: { code: 'PERMISSION_DENIED', message: 'Nope.', status: 403 },
    }),
  );

  await assert.rejects(() => client.createWorkspace({ name: 'Demo' }), (error) => {
    assert.equal(error instanceof HeadsUpApiError, true);
    assert.equal(error.code, 'PERMISSION_DENIED');
    assert.equal(error.status, 403);
    return true;
  });
});

test('sends signed single events', async () => {
  const calls = [];
  const client = createHeadsUpClient({
    baseUrl: 'https://headsupp.example/',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        accepted: true,
        authenticated: true,
        queued: 1,
        rejected: 0,
        connector_key: 'ck_demo',
      }, 202);
    },
  });

  const result = await client.sendEvent({
    connectorKey: 'ck_demo',
    connectorSecret: 'hu_sec_test',
    timestamp: '2026-05-25T12:00:00.000Z',
    event: {
      idempotency_key: 'evt_1',
      signal_key: 'demo.metric',
      occurred_at: '2026-05-25T12:00:00.000Z',
      value: { num: 1 },
    },
  });

  assert.equal(result.queued, 1);
  assert.equal(calls[0].url, 'https://headsupp.example/v1/events/ck_demo');
  assert.match(calls[0].init.headers['X-HeadsUp-Signature'], /^sha256=[a-f0-9]{64}$/);
  assert.equal(JSON.parse(calls[0].init.body).signal_key, 'demo.metric');
});

test('accepts 202 ingest response when accepted is true', async () => {
  const client = createHeadsUpClient({
    baseUrl: 'https://headsupp.example',
    fetch: async () =>
      jsonResponse(
        {
          accepted: true,
          authenticated: true,
          queued: 1,
          rejected: 0,
          connector_key: 'ck_demo',
        },
        202,
      ),
  });
  const result = await client.sendEvent({
    connectorKey: 'ck_demo',
    connectorSecret: 'hu_sec_test',
    event: {
      idempotency_key: 'evt_accepted',
      signal_key: 'demo.metric',
      occurred_at: '2026-05-25T12:00:00.000Z',
      value: { num: 1 },
    },
  });
  assert.equal(result.accepted, true);
});

test('sends signed event batches', async () => {
  const calls = [];
  const client = createHeadsUpClient({
    baseUrl: 'https://headsupp.example',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ accepted: true, authenticated: true, queued: 2, rejected: 0, connector_key: 'ck_demo' }, 202);
    },
  });

  const result = await client.sendEvents({
    connectorKey: 'ck_demo',
    connectorSecret: 'hu_sec_test',
    timestamp: '2026-05-25T12:00:00.000Z',
    events: [
      { idempotency_key: 'evt_1', signal_key: 'demo.metric', occurred_at: '2026-05-25T12:00:00.000Z', value: { num: 1 } },
      { idempotency_key: 'evt_2', signal_key: 'demo.metric', occurred_at: '2026-05-25T12:01:00.000Z', value: { num: 2 } },
    ],
  });

  assert.equal(result.queued, 2);
  assert.equal(JSON.parse(calls[0].init.body).events.length, 2);
});

test('throws ingest error when accepted is not true', async () => {
  const client = createHeadsUpClient({
    baseUrl: 'https://headsupp.example',
    fetch: async () =>
      jsonResponse(
        {
          accepted: false,
          authenticated: true,
          queued: 0,
          rejected: 1,
          error: { code: 'INVALID_EVENT_PAYLOAD', message: 'Missing value.', status: 400 },
        },
        202,
      ),
  });

  await assert.rejects(
    () =>
      client.sendEvent({
        connectorKey: 'ck_demo',
        connectorSecret: 'hu_sec_test',
        event: {
          idempotency_key: 'evt_rejected',
          signal_key: 'demo.metric',
          occurred_at: '2026-05-25T12:00:00.000Z',
          value: { num: 1 },
        },
      }),
    (error) => {
      assert.equal(error instanceof HeadsUpApiError, true);
      assert.equal(error.code, 'INVALID_EVENT_PAYLOAD');
      assert.equal(error.status, 400);
      assert.equal(error.response.accepted, false);
      return true;
    },
  );
});
