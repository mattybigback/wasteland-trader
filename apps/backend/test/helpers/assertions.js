function assertStatus(assert, response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
}

function assertErrorContains(assert, response, expectedStatus, pattern) {
  assert.equal(response.status, expectedStatus);
  assert.equal(typeof response.body.error, 'string');
  assert.match(response.body.error, pattern);
}

module.exports = {
  assertStatus,
  assertErrorContains
};
