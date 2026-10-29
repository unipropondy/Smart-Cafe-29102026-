const sql = require('mssql');
const { poolPromise } = require('../../config/db');

const getReadOnlyPool = async () => {
  return poolPromise;
};

module.exports = {
  sql,
  getReadOnlyPool
};
