class BlueNexusInterpreter {
  constructor(consoleOutput, stackPopup, varPopup) {
    this.consoleOutput = consoleOutput;
    this.stackPopup = stackPopup;
    this.varPopup = varPopup;
    this.reset();
  }

  reset() {
    this.stack = [];
    this.variables = {};
    this.output = [];
    this.halted = false;
  }

  log(msg, isError) {
    if (isError) {
      this.output.push('<span class="error-text">' + msg + '</span>');
    } else {
      this.output.push(msg);
    }
    this.consoleOutput.innerHTML = this.output.join('');
    this.consoleOutput.scrollTop = this.consoleOutput.scrollHeight;
  }

  async promptInput() {
    return new Promise(function(resolve) {
      const input = prompt('Enter input:');
      if (input === null) {
        resolve(0);
      } else {
        const num = parseFloat(input);
        resolve(isNaN(num) ? 0 : num);
      }
    });
  }

  tokenize(code) {
    let cleaned = code.replace(/[\s,]/g, '');
    let tokens = [];
    let i = 0;

    while (i < cleaned.length) {
      let startIdx = i;
      
      if (cleaned[i] === '>' && i + 1 < cleaned.length && /[A-Za-z]/.test(cleaned[i + 1])) {
        let varName = cleaned[i + 1];
        i += 2;
        
        if (cleaned[i] !== '<') {
          let expr = '';
          while (i < cleaned.length && cleaned[i] !== '<') {
            expr += cleaned[i];
            i++;
          }
          if (i < cleaned.length && cleaned[i] === '<') i++;
          tokens.push({ type: 'var-expr', name: varName, expr: expr, idx: startIdx });
        } else {
          i++;
          let depth = 1;
          let content = '';
          while (i < cleaned.length && depth > 0) {
            if (cleaned[i] === '>' && i + 1 < cleaned.length && /[A-Za-z]/.test(cleaned[i + 1])) {
              depth++;
              content += cleaned[i];
            } else if (cleaned[i] === '<') {
              depth--;
              if (depth > 0) content += cleaned[i];
            } else {
              content += cleaned[i];
            }
            i++;
          }
          tokens.push({ type: 'var-block', name: varName, content: content, idx: startIdx });
        }
        continue;
      }

      if (cleaned[i] === '?') {
        i++;
        if (cleaned[i] !== '[') {
          this.log('[BN-02] Syntax Error @ char ' + startIdx, true);
          this.halted = true;
          return [];
        }
        i++;
        let condType = '';
        while (i < cleaned.length && cleaned[i] !== ']') {
          condType += cleaned[i++];
        }
        i++;
        
        if (cleaned[i] !== '{') {
          this.log('[BN-02] Syntax Error @ char ' + startIdx, true);
          this.halted = true;
          return [];
        }
        i++;
        let cond = '';
        while (i < cleaned.length && cleaned[i] !== '}') {
          cond += cleaned[i++];
        }
        i++;
        
        if (cleaned[i] !== '(') {
          this.log('[BN-02] Syntax Error @ char ' + startIdx, true);
          this.halted = true;
          return [];
        }
        i++;
        let cmd = '';
        let depth = 1;
        while (i < cleaned.length && depth > 0) {
          if (cleaned[i] === '(') depth++;
          else if (cleaned[i] === ')') depth--;
          if (depth > 0) cmd += cleaned[i];
          i++;
        }
        tokens.push({ type: 'conditional', condType: condType, cond: cond, cmd: cmd, idx: startIdx });
        continue;
      }

      if ((cleaned[i] === '↡' || cleaned[i] === '▼') && i + 1 < cleaned.length && cleaned[i + 1] === '[') {
        i += 2;
        let param = '';
        while (i < cleaned.length && cleaned[i] !== ']') {
          param += cleaned[i++];
        }
        i++;
        tokens.push({ type: 'popn', param: param, idx: startIdx });
        continue;
      }

      if (cleaned[i] === '"') {
        i++;
        let str = '';
        while (i < cleaned.length && cleaned[i] !== '"') {
          if (cleaned[i] === '"' && i + 1 < cleaned.length && cleaned[i + 1] === '"') {
            str += '"';
            i += 2;
          } else {
            str += cleaned[i++];
          }
        }
        i++;
        tokens.push({ type: 'string', value: str, idx: startIdx });
        continue;
      }

      if (/[0-9]/.test(cleaned[i])) {
        let num = '';
        while (i < cleaned.length && /[0-9]/.test(cleaned[i])) {
          num += cleaned[i++];
        }
        tokens.push({ type: 'number', value: parseInt(num), idx: startIdx });
        continue;
      }

      if (cleaned[i] === '_') {
        let cmd = '_';
        i++;
        while (i < cleaned.length && /[a-zA-Z=]/.test(cleaned[i])) {
          cmd += cleaned[i++];
        }
        tokens.push({ type: 'debug', cmd: cmd, idx: startIdx });
        continue;
      }

      if (i + 1 < cleaned.length) {
        let twoChar = cleaned[i] + cleaned[i + 1];
        if (['>=', '<=', '!='].includes(twoChar)) {
          tokens.push({ type: 'compare', op: twoChar, idx: startIdx });
          i += 2;
          continue;
        }
      }

      const singleChars = '▲▼⇅↔+-×÷%#$¦&~><=!*"';
      if (singleChars.includes(cleaned[i])) {
        tokens.push({ type: 'single', char: cleaned[i], idx: startIdx });
        i++;
        continue;
      }

      if (/[A-Za-z]/.test(cleaned[i])) {
        tokens.push({ type: 'varref', name: cleaned[i], idx: startIdx });
        i++;
        continue;
      }

      if (cleaned[i] === '.') {
        if (i + 1 < cleaned.length && cleaned[i + 1] === '$') {
          i += 2;
          if (/[A-Za-z]/.test(cleaned[i])) {
            tokens.push({ type: 'rotate-silent', name: cleaned[i], idx: startIdx });
            i++;
          }
          continue;
        }
        tokens.push({ type: 'single', char: '.', idx: startIdx });
        i++;
        continue;
      }

      this.log('[BN-06] Unknown Command @ char ' + startIdx + ': ' + cleaned[i], true);
      this.halted = true;
      return [];
    }

    return tokens;
  }

  async executeVarBlock(token) {
    let subTokens = this.tokenize(token.content);
    if (this.halted) return;
    
    if (subTokens.length === 0) return;
    
    if (subTokens.length === 1) {
      if (subTokens[0].type === 'single' && subTokens[0].char === '~') {
        if (this.stack.length > 0) {
          this.variables[token.name] = this.stack[this.stack.length - 1];
        }
        return;
      } else if (subTokens[0].type === 'single' && subTokens[0].char === '&') {
        let input = await this.promptInput();
        this.variables[token.name] = input;
        return;
      } else if (subTokens[0].type === 'number') {
        this.variables[token.name] = subTokens[0].value;
        return;
      } else if (subTokens[0].type === 'string') {
        let codes = [];
        for (let ch of subTokens[0].value) {
          codes.push(ch.charCodeAt(0));
        }
        this.variables[token.name] = codes;
        return;
      }
    }
    
    if (subTokens.length >= 2 && subTokens[0].type === 'single' && subTokens[0].char === '.') {
      if (subTokens[1].type === 'string') {
        if (!(token.name in this.variables)) {
          this.variables[token.name] = [];
        }
        let codes = [];
        for (let ch of subTokens[1].value) {
          codes.push(ch.charCodeAt(0));
        }
        if (Array.isArray(this.variables[token.name])) {
          this.variables[token.name].push(...codes);
        } else {
          this.variables[token.name] = codes;
        }
        return;
      } else if (subTokens[1].type === 'single' && subTokens[1].char === '&') {
        let input = await this.promptInput();
        if (!(token.name in this.variables)) {
          this.variables[token.name] = input;
        } else if (typeof this.variables[token.name] === 'number') {
          this.variables[token.name] = parseInt(this.variables[token.name].toString() + input.toString());
        }
        return;
      }
    }
    
    await this.execute(subTokens);
    if (this.stack.length > 0 && !this.halted) {
      this.variables[token.name] = this.stack.pop();
    }
  }

  async executeVarExpr(token) {
    if (!(token.name in this.variables)) {
      this.variables[token.name] = 0;
    }
    
    let op = token.expr[0];
    let value = parseInt(token.expr.substring(1));
    
    if (op === '+') {
      this.variables[token.name] += value;
    } else if (op === '-') {
      this.variables[token.name] -= value;
    } else if (op === '×') {
      this.variables[token.name] *= value;
    } else if (op === '÷') {
      this.variables[token.name] = Math.floor(this.variables[token.name] / value);
    }
  }

  executePopN(token) {
    if (token.param === '.') {
      this.stack = [];
    } else if (/[A-Za-z]/.test(token.param)) {
      if (token.param in this.variables && Array.isArray(this.variables[token.param])) {
        this.variables[token.param].shift();
      }
    } else {
      let n = parseInt(token.param);
      for (let i = 0; i < n && this.stack.length > 0; i++) {
        this.stack.pop();
      }
    }
  }

  async executeConditional(token) {
    if (token.condType === '!?') {
      if (this.evaluateCondition(token.cond)) {
        let cmdTokens = this.tokenize(token.cmd);
        if (!this.halted) {
          await this.execute(cmdTokens);
        }
      }
    } else if (token.condType === '!∞') {
      while (this.evaluateCondition(token.cond) && !this.halted) {
        let cmdTokens = this.tokenize(token.cmd);
        await this.execute(cmdTokens);
      }
    } else if (token.condType === '!∑') {
      let varMatch = token.cond.match(/"?\*([A-Za-z])/);
      if (varMatch && varMatch[1] in this.variables) {
        let varName = varMatch[1];
        let arr = this.variables[varName];
        if (Array.isArray(arr)) {
          let len = arr.length;
          for (let i = 0; i < len && !this.halted; i++) {
            let cmdTokens = this.tokenize(token.cmd);
            await this.execute(cmdTokens);
          }
        }
      }
    }
  }

  evaluateCondition(cond) {
    let tokens = this.tokenize(cond);
    if (tokens.length === 0) return false;
    
    if (tokens.length >= 3) {
      let left, right;
      
      if (tokens[0].type === 'single' && tokens[0].char === '~') {
        left = this.stack.length > 0 ? this.stack[this.stack.length - 1] : 0;
      } else if (tokens[0].type === 'varref') {
        left = this.variables[tokens[0].name] || 0;
      } else if (tokens[0].type === 'number') {
        left = tokens[0].value;
      } else {
        return false;
      }
      
      let op;
      if (tokens[1].type === 'compare') {
        op = tokens[1].op;
      } else if (tokens[1].type === 'single') {
        op = tokens[1].char;
      } else {
        return false;
      }
      
      if (tokens[2].type === 'number') {
        right = tokens[2].value;
      } else if (tokens[2].type === 'varref') {
        right = this.variables[tokens[2].name] || 0;
      } else if (tokens[2].type === 'single' && tokens[2].char === '~') {
        right = this.stack.length > 0 ? this.stack[this.stack.length - 1] : 0;
      } else {
        return false;
      }
      
      switch (op) {
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
        case '=': return left === right;
        case '!=': return left !== right;
      }
    }
    
    return false;
  }

  executeDebug(token) {
    if (token.cmd === '_stack') {
      document.getElementById('stack-display').innerHTML = '';
      for (let i = 0; i < this.stack.length; i++) {
        let div = document.createElement('div');
        div.className = 'stack-item';
        div.textContent = this.stack[i];
        document.getElementById('stack-display').appendChild(div);
      }
      this.stackPopup.style.display = 'block';
    } else if (token.cmd.startsWith('_var=')) {
      let varName = token.cmd.substring(5);
      if (varName in this.variables) {
        document.getElementById('var-popup-title').textContent = 'Variable: ' + varName;
        let val = this.variables[varName];
        if (Array.isArray(val)) {
          document.getElementById('var-display').textContent = '[' + val.join(', ') + ']';
        } else {
          document.getElementById('var-display').textContent = val;
        }
        this.varPopup.style.display = 'block';
      }
    }
  }

  async execute(tokens) {
    for (let i = 0; i < tokens.length && !this.halted; i++) {
      let token = tokens[i];
      
      if (token.type === 'push-input') {
        let input = await this.promptInput();
        this.stack.push(input);
      } else if (token.type === 'push-num') {
        this.stack.push(token.value);
      } else if (token.type === 'push-var') {
        if (!(token.name in this.variables)) {
          this.log('[BN-01] Undefined Variable @ char ' + token.idx + ': ' + token.name, true);
          this.halted = true;
          break;
        }
        let val = this.variables[token.name];
        if (Array.isArray(val)) {
          if (val.length > 0) {
            this.stack.push(val[0]);
            val.push(val.shift());
          }
        } else {
          this.stack.push(val);
        }
      } else if (token.type === 'single') {
        if (token.char === '▼') {
          if (this.stack.length > 0) this.stack.pop();
        } else if (token.char === '⇅') {
          if (this.stack.length > 0) {
            this.stack.push(this.stack[this.stack.length - 1]);
          }
        } else if (token.char === '↔') {
          if (this.stack.length >= 2) {
            let a = this.stack.pop();
            let b = this.stack.pop();
            this.stack.push(a);
            this.stack.push(b);
          }
        } else if (token.char === '+') {
          if (this.stack.length >= 2) {
            let b = this.stack[this.stack.length - 1];
            let a = this.stack[this.stack.length - 2];
            this.stack.push(a + b);
          }
        } else if (token.char === '-') {
          if (this.stack.length >= 2) {
            let b = this.stack[this.stack.length - 1];
            let a = this.stack[this.stack.length - 2];
            this.stack.push(a - b);
          }
        } else if (token.char === '×') {
          if (this.stack.length >= 2) {
            let b = this.stack[this.stack.length - 1];
            let a = this.stack[this.stack.length - 2];
            this.stack.push(a * b);
          }
        } else if (token.char === '÷') {
          if (this.stack.length >= 2) {
            let b = this.stack[this.stack.length - 1];
            let a = this.stack[this.stack.length - 2];
            this.stack.push(Math.floor(a / b));
          }
        } else if (token.char === '%') {
          if (this.stack.length >= 2) {
            let b = this.stack[this.stack.length - 1];
            let a = this.stack[this.stack.length - 2];
            this.stack.push(a % b);
          }
        } else if (token.char === '#') {
          if (i + 1 < tokens.length && tokens[i + 1].type === 'varref') {
            let varName = tokens[i + 1].name;
            if (varName in this.variables) {
              let val = this.variables[varName];
              if (Array.isArray(val)) {
                this.log(val.map(c => String.fromCharCode(c)).join(''));
              } else {
                this.log(val.toString());
              }
            }
            i++;
          } else if (this.stack.length > 0) {
            this.log(this.stack[this.stack.length - 1].toString());
          }
        } else if (token.char === '$') {
          if (i + 1 < tokens.length && tokens[i + 1].type === 'varref') {
            let varName = tokens[i + 1].name;
            if (varName in this.variables) {
              let val = this.variables[varName];
              if (Array.isArray(val)) {
                if (val.length > 0) {
                  this.log(String.fromCharCode(val[0]));
                  val.push(val.shift());
                }
              } else {
                this.log(String.fromCharCode(val));
              }
            }
            i++;
          } else if (this.stack.length > 0) {
            this.log(String.fromCharCode(this.stack[this.stack.length - 1]));
          }
        } else if (token.char === '¦') {
          this.log('\n');
        }
      } else if (token.type === 'var-block') {
        await this.executeVarBlock(token);
      } else if (token.type === 'var-expr') {
        await this.executeVarExpr(token);
      } else if (token.type === 'popn') {
        this.executePopN(token);
      } else if (token.type === 'conditional') {
        await this.executeConditional(token);
      } else if (token.type === 'debug') {
        this.executeDebug(token);
      } else if (token.type === 'rotate-silent') {
        if (token.name in this.variables && Array.isArray(this.variables[token.name])) {
          let val = this.variables[token.name];
          if (val.length > 0) {
            val.push(val.shift());
          }
        }
      }
    }
  }

  async run(code) {
    this.reset();
    this.consoleOutput.innerHTML = '';
    
    let tokens = this.tokenize(code);
    if (this.halted) return;
    
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'single' && tokens[i].char === '▲') {
        if (i + 1 < tokens.length) {
          let next = tokens[i + 1];
          if (next.type === 'single' && next.char === '&') {
            tokens.splice(i, 2, { type: 'push-input', idx: tokens[i].idx });
          } else if (next.type === 'number') {
            tokens.splice(i, 2, { type: 'push-num', value: next.value, idx: tokens[i].idx });
          } else if (next.type === 'varref') {
            tokens.splice(i, 2, { type: 'push-var', name: next.name, idx: tokens[i].idx });
          }
        }
      }
    }
    
    await this.execute(tokens);
    
    if (!this.halted && this.output.length === 0) {
      this.log('<span style="color: #0f0;">Program completed.</span>\n');
    }
  }
}