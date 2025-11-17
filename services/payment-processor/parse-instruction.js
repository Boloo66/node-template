const validator = require('@app-core/validator');
const { throwAppError, ERROR_CODE } = require('@app-core/errors');
const { appLogger } = require('@app-core/logger');
const { PaymentMessages } = require('@app/messages');

const spec = `root {
  accounts[] {
    id string
    balance number
    currency string
  }
  instruction string
}`;

const parsedSpec = validator.parse(spec);

const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'GHS'];

const VALID_ACCOUNT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.@';

/**
 * Find keyword index in words array
 * @param {string[]} words - Words array to search
 * @param {string} keyword - Keyword to find
 * @param {number} startIndex - Starting index for search
 * @returns {number} Index of keyword or -1 if not found
 */
function findKeywordIndex(words, keyword, startIndex = 0) {
  for (let i = startIndex; i < words.length; i += 1) {
    if (words[i].toLowerCase() === keyword.toLowerCase()) {
      return i;
    }
  }
  return -1;
}

/**
 * Check if account ID has valid characters
 * @param {string} accountId - Account ID to validate
 * @returns {boolean} True if valid
 */
function isValidAccountId(accountId) {
  for (let i = 0; i < accountId.length; i += 1) {
    const char = accountId[i];
    if (!VALID_ACCOUNT_CHARS.includes(char)) {
      return false;
    }
  }
  return accountId.length > 0;
}

/**
 * Check if transaction should execute immediately
 * @param {string} executeBy - Execution date string
 * @returns {boolean} True if should execute now
 */
function shouldExecuteNow(executeBy) {
  if (!executeBy) return true;

  const transactionDate = new Date(executeBy);
  const today = new Date();

  const transactionDateOnly = new Date(
    transactionDate.getFullYear(),
    transactionDate.getMonth(),
    transactionDate.getDate()
  );
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return transactionDateOnly <= todayOnly;
}

/**
 * Process accounts for transaction execution
 * @param {Object[]} accounts - Original accounts array
 * @param {Object} parsed - Parsed instruction data
 * @param {boolean} shouldExecute - Whether to execute transaction
 * @returns {Object[]} Processed accounts array
 */
function processAccounts(accounts, parsed, shouldExecute) {
  const result = [];

  accounts.forEach((account) => {
    if (account.id === parsed.debit_account || account.id === parsed.credit_account) {
      const balanceBefore = account.balance;
      let balanceAfter = balanceBefore;

      if (shouldExecute) {
        if (account.id === parsed.debit_account) {
          balanceAfter = balanceBefore - parsed.amount;
        } else if (account.id === parsed.credit_account) {
          balanceAfter = balanceBefore + parsed.amount;
        }
      }

      result.push({
        id: account.id,
        balance: balanceAfter,
        balance_before: balanceBefore,
        currency: account.currency.toUpperCase(),
      });
    }
  });

  return result;
}

/**
 * Parse DEBIT format instruction
 * @param {string[]} words - Instruction words array
 * @param {string} originalInstruction - Original instruction text
 * @returns {Object} Parsed instruction data
 */
function parseDebitFormat(words) {
  const debitIndex = findKeywordIndex(words, 'debit');
  const fromIndex = findKeywordIndex(words, 'from');
  const accountIndexAfterFrom = fromIndex + 1;
  const forIndex = findKeywordIndex(words, 'for');
  const creditIndex = forIndex + 1;
  const toIndex = findKeywordIndex(words, 'to', creditIndex);
  const accountIndexAfterTo = toIndex + 1;

  if (
    debitIndex === -1 ||
    fromIndex === -1 ||
    forIndex === -1 ||
    creditIndex === -1 ||
    toIndex === -1
  ) {
    throwAppError(PaymentMessages.INVALID_KEYWORD_ORDER, ERROR_CODE.INVLDDATA);
  }

  const amountStr = words[debitIndex + 1];
  const amount = parseInt(amountStr, 10);
  if (Number.isNaN(amount) || amount <= 0) {
    throwAppError(PaymentMessages.INVALID_AMOUNT, ERROR_CODE.INVLDDATA);
  }

  const currency = words[debitIndex + 2]?.toUpperCase();
  if (!currency || !SUPPORTED_CURRENCIES.includes(currency)) {
    throwAppError(PaymentMessages.UNSUPPORTED_CURRENCY, ERROR_CODE.INVLDDATA);
  }

  if (words[accountIndexAfterFrom]?.toLowerCase() !== 'account') {
    throwAppError(PaymentMessages.MISSING_KEYWORD, ERROR_CODE.INVLDDATA);
  }
  const debitAccount = words[accountIndexAfterFrom + 1];

  if (words[accountIndexAfterTo]?.toLowerCase() !== 'account') {
    throwAppError(PaymentMessages.MISSING_KEYWORD, ERROR_CODE.INVLDDATA);
  }
  const creditAccount = words[accountIndexAfterTo + 1];

  const onIndex = findKeywordIndex(words, 'on');
  let executeBy = null;
  if (onIndex !== -1 && words[onIndex + 1]) {
    executeBy = words[onIndex + 1];
  }

  return {
    type: 'DEBIT',
    amount,
    currency,
    debit_account: debitAccount,
    credit_account: creditAccount,
    execute_by: executeBy,
  };
}

/**
 * Parse CREDIT format instruction
 * @param {string[]} words - Instruction words array
 * @param {string} originalInstruction - Original instruction text
 * @returns {Object} Parsed instruction data
 */
function parseCreditFormat(words) {
  const creditIndex = findKeywordIndex(words, 'credit');
  const toIndex = findKeywordIndex(words, 'to');
  const accountIndexAfterTo = toIndex + 1;
  const forIndex = findKeywordIndex(words, 'for');
  const debitIndex = forIndex + 1;
  const fromIndex = findKeywordIndex(words, 'from', debitIndex);
  const accountIndexAfterFrom = fromIndex + 1;

  if (
    creditIndex === -1 ||
    toIndex === -1 ||
    forIndex === -1 ||
    debitIndex === -1 ||
    fromIndex === -1
  ) {
    throwAppError(PaymentMessages.INVALID_KEYWORD_ORDER, ERROR_CODE.INVLDDATA);
  }

  const amountStr = words[creditIndex + 1];
  const amount = parseInt(amountStr, 10);
  if (Number.isNaN(amount) || amount <= 0) {
    throwAppError(PaymentMessages.INVALID_AMOUNT, ERROR_CODE.INVLDDATA);
  }

  const currency = words[creditIndex + 2]?.toUpperCase();
  if (!currency || !SUPPORTED_CURRENCIES.includes(currency)) {
    throwAppError(PaymentMessages.UNSUPPORTED_CURRENCY, ERROR_CODE.INVLDDATA);
  }

  if (words[accountIndexAfterTo]?.toLowerCase() !== 'account') {
    throwAppError(PaymentMessages.MISSING_KEYWORD, ERROR_CODE.INVLDDATA);
  }
  const creditAccount = words[accountIndexAfterTo + 1];

  if (words[accountIndexAfterFrom]?.toLowerCase() !== 'account') {
    throwAppError(PaymentMessages.MISSING_KEYWORD, ERROR_CODE.INVLDDATA);
  }
  const debitAccount = words[accountIndexAfterFrom + 1];

  const onIndex = findKeywordIndex(words, 'on');
  let executeBy = null;
  if (onIndex !== -1 && words[onIndex + 1]) {
    executeBy = words[onIndex + 1];
  }

  return {
    type: 'CREDIT',
    amount,
    currency,
    debit_account: debitAccount,
    credit_account: creditAccount,
    execute_by: executeBy,
  };
}

/**
 * Validate parsed data against business rules
 * @param {Object} parsed - Parsed instruction data
 * @param {Object[]} accounts - Accounts array
 */
function validateParsedData(parsed, accounts) {
  if (!isValidAccountId(parsed.debit_account)) {
    throwAppError(PaymentMessages.INVALID_ACCOUNT_ID, ERROR_CODE.INVLDDATA);
  }
  if (!isValidAccountId(parsed.credit_account)) {
    throwAppError(PaymentMessages.INVALID_ACCOUNT_ID, ERROR_CODE.INVLDDATA);
  }

  if (parsed.debit_account === parsed.credit_account) {
    throwAppError(PaymentMessages.SAME_ACCOUNT_ERROR, ERROR_CODE.INVLDDATA);
  }

  const debitAccount = accounts.find((acc) => acc.id === parsed.debit_account);
  const creditAccount = accounts.find((acc) => acc.id === parsed.credit_account);

  if (!debitAccount) {
    throwAppError(PaymentMessages.ACCOUNT_NOT_FOUND, ERROR_CODE.INVLDDATA);
  }
  if (!creditAccount) {
    throwAppError(PaymentMessages.ACCOUNT_NOT_FOUND, ERROR_CODE.INVLDDATA);
  }

  if (debitAccount.currency.toUpperCase() !== parsed.currency) {
    throwAppError(PaymentMessages.CURRENCY_MISMATCH, ERROR_CODE.INVLDDATA);
  }
  if (creditAccount.currency.toUpperCase() !== parsed.currency) {
    throwAppError(PaymentMessages.CURRENCY_MISMATCH, ERROR_CODE.INVLDDATA);
  }

  if (debitAccount.balance < parsed.amount) {
    throwAppError(PaymentMessages.INSUFFICIENT_FUNDS, ERROR_CODE.INVLDDATA);
  }

  if (parsed.execute_by) {
    const date = new Date(parsed.execute_by);
    if (Number.isNaN(date.getTime())) {
      throwAppError(PaymentMessages.INVALID_DATE_FORMAT, ERROR_CODE.INVLDDATA);
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(parsed.execute_by)) {
      throwAppError(PaymentMessages.INVALID_DATE_FORMAT, ERROR_CODE.INVLDDATA);
    }
  }
}

/**
 * Parse instruction text into structured data
 * @param {string} instruction - Raw instruction text
 * @returns {Object} Parsed instruction data
 */
function parseInstructionText(instruction) {
  const words = instruction.split(' ').filter((word) => word.length > 0);
  const lowerInstruction = instruction.toLowerCase();

  if (
    lowerInstruction.includes('debit') &&
    lowerInstruction.includes('from account') &&
    lowerInstruction.includes('for credit to account')
  ) {
    return parseDebitFormat(words, instruction);
  }

  if (
    lowerInstruction.includes('credit') &&
    lowerInstruction.includes('to account') &&
    lowerInstruction.includes('for debit from account')
  ) {
    return parseCreditFormat(words, instruction);
  }

  throwAppError(PaymentMessages.MALFORMED_INSTRUCTION, ERROR_CODE.INVLDDATA);
}

/**
 * Parse payment instruction and execute transaction
 * @param {Object} serviceData - Input data containing accounts and instruction
 * @param {Object} options - Optional configuration
 * @returns {Object} Transaction response
 */
async function parseInstruction(serviceData) {
  let response;

  const data = validator.validate(serviceData, parsedSpec);

  try {
    const instruction = data.instruction.trim();
    const { accounts } = data;

    appLogger.info({ instruction }, 'parsing-instruction');

    const parsed = parseInstructionText(instruction);

    validateParsedData(parsed, accounts);

    const shouldExecute = shouldExecuteNow(parsed.execute_by);

    const processedAccounts = processAccounts(accounts, parsed, shouldExecute);

    response = {
      type: parsed.type,
      amount: parsed.amount,
      currency: parsed.currency,
      debit_account: parsed.debit_account,
      credit_account: parsed.credit_account,
      execute_by: parsed.execute_by,
      status: shouldExecute ? 'successful' : 'pending',
      status_reason: shouldExecute
        ? PaymentMessages.TRANSACTION_SUCCESSFUL
        : PaymentMessages.TRANSACTION_PENDING,
      status_code: shouldExecute ? 'AP00' : 'AP02',
      accounts: processedAccounts,
    };

    appLogger.info({ response }, 'instruction-processed');
  } catch (error) {
    appLogger.errorX(error, 'parse-instruction-error');
    throw error;
  }

  return response;
}

module.exports = parseInstruction;
