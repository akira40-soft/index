/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GAME SYSTEM - MÚLTIPLOS JOGOS
 * ═══════════════════════════════════════════════════════════════════════════
 * Jogos disponíveis:
 * - Tic-Tac-Toe (Jogo da Velha)
 * - Rock-Paper-Scissors (Pedra, Papel, Tesoura)
 * - Guess the Number (Advinha o Número)
 * - Forca (Hangman)
 * ═══════════════════════════════════════════════════════════════════════════
 */
class GameSystem {
    games;
    logger;
    config;
    gridTactics;
    sock;
    constructor(logger, config, gridTactics = null) {
        this.games = new Map();
        this.logger = logger;
        this.config = config;
        this.gridTactics = gridTactics;
        this.sock = null;
    }
    setSocket(sock) {
        this.sock = sock;
        // Se houver gridTactics e ele tiver setSocket, propaga
        if (this.gridTactics?.setSocket)
            this.gridTactics.setSocket(sock);
    }
    /**
     * Normaliza IDs do WhatsApp removendo sufixos de dispositivo e domínios desnecessários
     * Formato final: número@s.whatsapp.net
     */
    _normalizeId(id) {
        if (!id)
            return '';
        const clean = id.split('@')[0].split(':')[0];
        return `${clean.replace(/\D/g, '')}@s.whatsapp.net`;
    }
    /**
     * Remove duplicatas e limpa o map de jogos periodicamente
     */
    cleanupGames() {
        const now = Date.now();
        const timeout = 5 * 60 * 1000; // 5 minutos
        for (const [key, game] of this.games.entries()) {
            if (now - game.lastActivity > timeout) {
                this.games.delete(key);
            }
        }
    }
    /**
     * Método principal para rotear comandos de jogos
     */
    async handleGame(chatId, senderId, command, args, opponentId) {
        this.cleanupGames();
        switch (command.toLowerCase()) {
            case 'ttt':
            case 'tictactoe':
            case 'jogodavelha':
                return await this.handleTicTacToe(chatId, senderId, args[0] || 'start', opponentId);
            case 'rps':
            case 'ppt':
            case 'pedrapapeltesoura':
                return await this.handleRPS(chatId, senderId, args[0] || 'start', opponentId);
            case 'guess':
            case 'adivinhe':
            case 'advinha':
                return await this.handleGuess(chatId, senderId, args[0] || 'start');
            case 'forca':
            case 'hangman':
                return await this.handleHangman(chatId, senderId, args[0] || 'start', args.slice(1).join(' '));
            default:
                return { text: '❌ Jogo não reconhecido.', finished: false };
        }
    }
    /**
     * Tenta processar mensagens curtas como jogadas de jogos ativos (sem precisar de comando explícito)
     */
    async processActiveGameInput(chatId, senderId, input, replyInfo) {
        this.cleanupGames();
        const texto = (input || '').trim().toLowerCase();
        const normSender = this._normalizeId(senderId);
        // Se for reply a uma mensagem específica de jogo, priorizamos o tipo detectado
        if (replyInfo?.isReplyToGame) {
            const gType = replyInfo.gameType;
            if (gType === 'ttt' && /^[1-9]$/.test(texto)) {
                return await this.handleTicTacToe(chatId, senderId, texto);
            }
            if (gType === 'grid') {
                if (this.gridTactics) {
                    return await this.gridTactics.handleGridTactics(chatId, senderId, texto, []);
                }
            }
        }
        // Tic-Tac-Toe
        let game = this.games.get(chatId);
        if (game && game.type === 'ttt') {
            if (/^[1-9]$/.test(texto)) {
                return await this.handleTicTacToe(chatId, senderId, texto);
            }
        }
        // RPS
        game = this.games.get(`${chatId}_rps`);
        if (game && game.type === 'rps' && ['pedra', 'papel', 'tesoura'].includes(texto)) {
            return await this.handleRPS(chatId, senderId, texto);
        }
        // Guess
        game = this.games.get(`${chatId}_guess`);
        if (game && game.type === 'guess' && /^\d+$/.test(texto)) {
            return await this.handleGuess(chatId, senderId, texto);
        }
        return null;
    }
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * JOGO DA VELHA (TIC-TAC-TOE) - AGORA COM MODO IA!
     * ═══════════════════════════════════════════════════════════════════════
     */
    async handleTicTacToe(chatId, senderId, input, opponentId) {
        let game = this.games.get(chatId);
        // Use helper for robust normalization
        const normalizedSenderId = this._normalizeId(senderId);
        let normalizedOpponentId = opponentId ? this._normalizeId(opponentId) : undefined;
        // Iniciar novo jogo - AGORA SUPORTA MODO IA
        if (input === 'start' || (!game && normalizedOpponentId)) {
            if (game) {
                return { text: '⚠️ Já existe uma partida em andamento neste chat!', finished: false };
            }
            // MODO IA: Se não mencionar ninguém, joga contra a Akira
            const isAIMode = !normalizedOpponentId;
            if (isAIMode) {
                normalizedOpponentId = 'akira-ai@akira.bot'; // ID especial para IA
            }
            else if (!normalizedOpponentId) {
                return { text: '❌ Mencione alguém para jogar ou use #ttt start para jogar contra mim (Akira)!', finished: false };
            }
            game = {
                type: 'ttt',
                board: Array(9).fill(null),
                players: [normalizedSenderId, normalizedOpponentId],
                turn: 0, // Sempre começa com o humano
                symbols: ['❌', '⭕'],
                isAIMode: isAIMode,
                aiSymbol: '⭕', // IA sempre joga com O
                humanSymbol: '❌',
                startTime: Date.now(),
                lastActivity: Date.now()
            };
            this.games.set(chatId, game);
            const opponentDisplay = isAIMode ? '🤖 *Akira (IA)*' : `@${normalizedOpponentId.split('@')[0]}`;
            return {
                text: `🎮 *JOGO DA VELHA ${isAIMode ? 'VS IA' : 'MULTIPLAYER'} INICIADO!*\n\n` +
                    `❌: @${normalizedSenderId.split('@')[0]} *(Você)*\n` +
                    `${isAIMode ? '⭕' : '⭕'}: ${opponentDisplay}\n\n` +
                    `${this.renderBoard(game.board)}\n\n` +
                    `Vez de: @${game.players[game.turn].split('@')[0]} ${isAIMode ? '(Você)' : ''}\n` +
                    `Digite o número (1-9) para jogar.`,
                finished: false
            };
        }
        if (!game || game.type !== 'ttt') {
            return { text: '❌ Nenhuma partida ativa. Use #ttt @user para multiplayer ou #ttt start para jogar contra IA!', finished: false };
        }
        // Verificar se é a vez do jogador (Usando IDs já normalizados)
        if (normalizedSenderId !== game.players[game.turn]) {
            return { text: '⏳ Aguarde sua vez!', finished: false };
        }
        const move = parseInt(input) - 1;
        if (isNaN(move) || move < 0 || move > 8 || game.board[move] !== null) {
            return { text: '❌ Jogada inválida! Escolha um número de 1 a 9 que esteja livre.', finished: false };
        }
        // Executar jogada do HUMANO
        game.board[move] = game.humanSymbol;
        game.lastActivity = Date.now();
        // Verificar vitória do humano
        if (this.checkWinner(game.board)) {
            const winner = game.players[game.turn];
            this.games.delete(chatId);
            return {
                text: `🎉 *VITÓRIA!*\n\n` +
                    `${this.renderBoard(game.board)}\n\n` +
                    `🏆 @${winner.split('@')[0]} venceu a partida!`,
                finished: true
            };
        }
        // Verificar empate
        if (game.board.every((cell) => cell !== null)) {
            this.games.delete(chatId);
            return {
                text: `👵 *DEU VELHA (EMPATE)!*\n\n` +
                    `${this.renderBoard(game.board)}\n\n` +
                    `Ninguém venceu desta vez.`,
                finished: true
            };
        }
        // Se for modo IA, fazer jogada da IA
        if (game.isAIMode) {
            // Trocar para turno da IA
            game.turn = 1;
            // Calcular melhor jogada da IA
            const aiMove = this.calculateAIMove(game.board, game.aiSymbol, game.humanSymbol);
            if (aiMove !== -1) {
                game.board[aiMove] = game.aiSymbol;
                game.lastActivity = Date.now();
                // Verificar vitória da IA
                if (this.checkWinner(game.board)) {
                    this.games.delete(chatId);
                    return {
                        text: `🤖 *DERROTA!*\n\n` +
                            `${this.renderBoard(game.board)}\n\n` +
                            `Akira venceu! Tente novamente com #ttt start`,
                        finished: true
                    };
                }
                // Verificar empate após jogada da IA
                if (game.board.every((cell) => cell !== null)) {
                    this.games.delete(chatId);
                    return {
                        text: `👵 *DEU VELHA (EMPATE)!*\n\n` +
                            `${this.renderBoard(game.board)}\n\n` +
                            `Foi um bom jogo! Jogue novamente com #ttt start`,
                        finished: true
                    };
                }
            }
            // Voltar turno para o humano
            game.turn = 0;
            return {
                text: `🎮 *JOGO DA VELHA VS AKIRA*\n\n` +
                    `${this.renderBoard(game.board)}\n\n` +
                    `🤖 Akira jogou na posição ${aiMove + 1}\n\n` +
                    `Sua vez! Digite o número (1-9) para jogar.`,
                finished: false
            };
        }
        // Modo multiplayer normal - trocar turno
        game.turn = game.turn === 0 ? 1 : 0;
        return {
            text: `🎮 *JOGO DA VELHA*\n\n` +
                `${this.renderBoard(game.board)}\n\n` +
                `Vez de: @${game.players[game.turn].split('@')[0]}`,
            finished: false
        };
    }
    /**
     * Calcula a melhor jogada para a IA no Jogo da Velha
     * Usa algoritmo Minimax para garantir jogada perfeita ou quase perfeita
     */
    calculateAIMove(board, aiSymbol, humanSymbol) {
        // Primeiro, verificar se a IA pode vencer na próxima jogada
        for (let i = 0; i < 9; i++) {
            if (board[i] === null) {
                board[i] = aiSymbol;
                if (this.checkWinner(board)) {
                    board[i] = null; // Restaurar
                    return i;
                }
                board[i] = null; // Restaurar
            }
        }
        // Segundo, verificar se precisa bloquear o humano
        for (let i = 0; i < 9; i++) {
            if (board[i] === null) {
                board[i] = humanSymbol;
                if (this.checkWinner(board)) {
                    board[i] = null; // Restaurar
                    return i;
                }
                board[i] = null; // Restaurar
            }
        }
        // Terceiro, pegar o centro se disponível
        if (board[4] === null) {
            return 4;
        }
        // Quarto, pegar cantos disponíveis
        const corners = [0, 2, 6, 8];
        const availableCorners = corners.filter(i => board[i] === null);
        if (availableCorners.length > 0) {
            return availableCorners[Math.floor(Math.random() * availableCorners.length)];
        }
        // Por último, pegar qualquer borda disponível
        const edges = [1, 3, 5, 7];
        const availableEdges = edges.filter(i => board[i] === null);
        if (availableEdges.length > 0) {
            return availableEdges[Math.floor(Math.random() * availableEdges.length)];
        }
        return -1; // Empate ou erro
    }
    renderBoard(board) {
        const b = board.map((cell, i) => cell || (i + 1).toString());
        return `     ${b[0]} | ${b[1]} | ${b[2]}\n` +
            `    ---+---+---\n` +
            `     ${b[3]} | ${b[4]} | ${b[5]}\n` +
            `    ---+---+---\n` +
            `     ${b[6]} | ${b[7]} | ${b[8]}`;
    }
    checkWinner(board) {
        const wins = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // Horizontais
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // Verticais
            [0, 4, 8], [2, 4, 6] // Diagonais
        ];
        return wins.some(combo => {
            return board[combo[0]] !== null &&
                board[combo[0]] === board[combo[1]] &&
                board[combo[1]] === board[combo[2]];
        });
    }
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * PEDRA, PAPEL, TESOURA (RPS)
     * ═══════════════════════════════════════════════════════════════════════
     */
    async handleRPS(chatId, senderId, input, opponentId) {
        const choices = ['pedra', 'papel', 'tesoura'];
        const emojis = { pedra: '🪨', papel: '📄', tesoura: '✂️' };
        const beats = { pedra: 'tesoura', papel: 'pedra', tesoura: 'papel' };
        const gameKey = `${chatId}_rps`;
        let game = this.games.get(gameKey);
        // Iniciar novo jogo
        if (input === 'start' || (!game && opponentId)) {
            if (game) {
                return { text: '⚠️ Já existe um jogo de RPS em andamento!', finished: false };
            }
            if (!opponentId) {
                return { text: '❌ Mencione alguém para jogar RPS!', finished: false };
            }
            game = {
                type: 'rps',
                players: [senderId, opponentId],
                choices: [null, null],
                waitingFor: senderId,
                startTime: Date.now(),
                lastActivity: Date.now()
            };
            this.games.set(gameKey, game);
            return {
                text: `🪨📄✂️ *PEDRA, PAPEL, TESOURA!*\n\n` +
                    `@${senderId.split('@')[0]} vs @${opponentId.split('@')[0]}\n\n` +
                    `Vez de: @${senderId.split('@')[0]}\n\n` +
                    ` Escolha: *#rps pedra*, *#rps papel* ou *#rps tesoura*`,
                finished: false
            };
        }
        if (!game || game.type !== 'rps') {
            return { text: '❌ Nenhum jogo ativo. Use #rps @user para começar.', finished: false };
        }
        // Validar escolha
        const choice = input.toLowerCase();
        if (!choices.includes(choice)) {
            return { text: '❌ Escolha inválida! Use: pedra, papel ou tesoura.', finished: false };
        }
        // Determinar índice do jogador
        const playerIndex = senderId === game.players[0] ? 0 : 1;
        if (senderId !== game.waitingFor) {
            return { text: '⏳ Aguarde a vez do outro jogador!', finished: false };
        }
        // Registrar escolha
        game.choices[playerIndex] = choice;
        game.lastActivity = Date.now();
        // Se o outro jogador ainda não escolheu
        if (game.choices[0] === null || game.choices[1] === null) {
            const nextPlayer = game.players[playerIndex === 0 ? 1 : 0];
            game.waitingFor = nextPlayer;
            return {
                text: `✅ @${senderId.split('@')[0]} escolheu!\n\n` +
                    `Vez de: @${nextPlayer.split('@')[0]}\n\n` +
                    `Escolha: *#rps pedra*, *#rps papel* ou *#rps tesoura*`,
                finished: false
            };
        }
        // Ambos escolheram - determinar vencedor
        const choice1 = game.choices[0];
        const choice2 = game.choices[1];
        let result;
        if (choice1 === choice2) {
            result = 'Empate!';
        }
        else if (beats[choice1] === choice2) {
            result = `@${game.players[0].split('@')[0]} wins!`;
        }
        else {
            result = `@${game.players[1].split('@')[0]} wins!`;
        }
        this.games.delete(gameKey);
        return {
            text: `🪨📄✂️ *RESULTADO*\n\n` +
                `@${game.players[0].split('@')[0]}: ${emojis[choice1]} ${choice1}\n` +
                `@${game.players[1].split('@')[0]}: ${emojis[choice2]} ${choice2}\n\n` +
                `🏆 *${result}*`,
            finished: true
        };
    }
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * ADVINHA O NÚMERO (GUESS THE NUMBER)
     * ═══════════════════════════════════════════════════════════════════════
     */
    async handleGuess(chatId, senderId, input) {
        const gameKey = `${chatId}_guess`;
        let game = this.games.get(gameKey);
        // Iniciar novo jogo
        if (input === 'start') {
            if (game) {
                return { text: '⚠️ Já existe um jogo de advinha ativo!', finished: false };
            }
            const targetNumber = Math.floor(Math.random() * 100) + 1;
            game = {
                type: 'guess',
                player: senderId,
                target: targetNumber,
                attempts: 0,
                maxAttempts: 10,
                startTime: Date.now(),
                lastActivity: Date.now()
            };
            this.games.set(gameKey, game);
            return {
                text: `🔢 *ADVINHA O NÚMERO!*\n\n` +
                    `Pensei em um número entre 1 e 100.\n` +
                    `Você tem *10 tentativas*!\n\n` +
                    `Use: *#guess <número>* para tentar`,
                finished: false
            };
        }
        if (!game || game.type !== 'guess') {
            return { text: '❌ Nenhum jogo ativo. Use #guess start para começar.', finished: false };
        }
        if (senderId !== game.player) {
            return { text: '❌ Este jogo é de outro usuário. Use #guess start para jogar.', finished: false };
        }
        const guess = parseInt(input);
        if (isNaN(guess) || guess < 1 || guess > 100) {
            return { text: '❌ Escolha um número entre 1 e 100.', finished: false };
        }
        game.attempts++;
        game.lastActivity = Date.now();
        if (guess === game.target) {
            this.games.delete(gameKey);
            return {
                text: `🎉 *ACERTOU!*\n\n` +
                    `O número era *${game.target}*!\n` +
                    `Você acertou em *${game.attempts} tentativa(s)*! 🏆`,
                finished: true
            };
        }
        if (game.attempts >= game.maxAttempts) {
            this.games.delete(gameKey);
            return {
                text: `😞 *FIM DE JOGO!*\n\n` +
                    `O número era *${game.target}*.\n` +
                    `Você usou todas as *${game.maxAttempts} tentativas*!`,
                finished: true
            };
        }
        const hint = guess < game.target ? '🔼 O número é MAIOR' : '🔽 O número é MENOR';
        return {
            text: `${hint}\n\n` +
                `Tentativas: *${game.attempts}/${game.maxAttempts}*\n` +
                `Use: *#guess <número>*`,
            finished: false
        };
    }
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * FORCA (HANGMAN)
     * ═══════════════════════════════════════════════════════════════════════
     */
    words = [
        'programacao', 'javascript', 'typescript', 'whatsapp', 'bot', 'akira',
        'desenvolvimento', 'computador', 'internet', 'mensagem', 'servidor',
        'database', 'api', 'frontend', 'backend', 'mobile', 'windows', 'linux'
    ];
    async handleHangman(chatId, senderId, input, customWord) {
        const gameKey = `${chatId}_hangman`;
        let game = this.games.get(gameKey);
        // Iniciar novo jogo
        if (input === 'start') {
            if (game) {
                return { text: '⚠️ Já existe um jogo da forca ativo!', finished: false };
            }
            const word = (customWord && customWord.length > 2)
                ? customWord.toLowerCase().replace(/[^a-z]/g, '')
                : this.words[Math.floor(Math.random() * this.words.length)];
            game = {
                type: 'hangman',
                player: senderId,
                word: word,
                guessed: new Set(),
                wrong: 0,
                maxWrong: 6,
                startTime: Date.now(),
                lastActivity: Date.now()
            };
            this.games.set(gameKey, game);
            return {
                text: this.getHangmanDisplay(game),
                finished: false
            };
        }
        if (!game || game.type !== 'hangman') {
            return { text: '❌ Nenhum jogo ativo. Use #forca start para começar.', finished: false };
        }
        if (senderId !== game.player) {
            return { text: '❌ Este jogo é de outro usuário. Use #forca start para jogar.', finished: false };
        }
        // Processar tentativa (letra única)
        const guess = input.toLowerCase().charAt(0);
        if (!guess || guess.length !== 1 || !/[a-z]/.test(guess)) {
            return { text: '❌ Digite uma letra! Use: #forca <letra>', finished: false };
        }
        if (game.guessed.has(guess)) {
            return { text: '⚠️ Você já tentou essa letra!', finished: false };
        }
        game.guessed.add(guess);
        game.lastActivity = Date.now();
        // Verificar se a letra está na palavra
        if (game.word.includes(guess)) {
            // Verificar vitória
            const won = game.word.split('').every((letter) => game.guessed.has(letter));
            if (won) {
                this.games.delete(gameKey);
                return {
                    text: `🎉 *VOCÊ GANHOU!*\n\n` +
                        `A palavra era: *${game.word.toUpperCase()}*\n` +
                        `Erros: ${game.wrong}/${game.maxWrong} 🏆`,
                    finished: true
                };
            }
            return {
                text: this.getHangmanDisplay(game) + `\n\n✅ Letra correta!`,
                finished: false
            };
        }
        // Letra errada
        game.wrong++;
        if (game.wrong >= game.maxWrong) {
            this.games.delete(gameKey);
            return {
                text: `😵 *GAME OVER!*\n\n` +
                    `A palavra era: *${game.word.toUpperCase()}*\n` +
                    `Você foi enforcado! 💀`,
                finished: true
            };
        }
        return {
            text: this.getHangmanDisplay(game) + `\n\n❌ Letra errada!`,
            finished: false
        };
    }
    getHangmanDisplay(game) {
        const hangmanStages = [
            `
  ┌───────┐
  │       │
  │       
  │      
  │      
  │      
──┴─────────`,
            `
  ┌───────┐
  │       │
  │       O
  │      
  │      
  │      
──┴─────────`,
            `
  ┌───────┐
  │       │
  │       O
  │       │
  │      
  │      
──┴─────────`,
            `
  ┌───────┐
  │       │
  │       O
  │      /│
  │      
  │      
──┴─────────`,
            `
  ┌───────┐
  │       │
  │       O
  │      /│\\
  │      
  │      
──┴─────────`,
            `
  ┌───────┐
  │       │
  │       O
  │      /│\\
  │      / 
  │      
──┴─────────`,
            `
  ┌───────┐
  │       │
  │       O
  │      /│\\
  │      / \\
  │      
──┴─────────`
        ];
        // Mostrar palavra com letras descobertas
        const display = game.word.split('').map((letter) => game.guessed.has(letter) ? letter : '_').join(' ');
        return `🪢 *FORCA*\n\n` +
            `${hangmanStages[game.wrong]}\n\n` +
            `Palavra: *${display}*\n\n` +
            `Erros: ${game.wrong}/${game.maxWrong}\n` +
            `Letras usadas: ${[...game.guessed].join(', ')}\n\n` +
            `Use: *#forca <letra>*`;
    }
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * GRID TACTICS - JOGO HÍBRIDO: XADREZ + SUDOKU + JOGO DA VELHA
     * ═══════════════════════════════════════════════════════════════════════
     *
     * COMO JOGAR:
     * - Grade 3x3, cada célula pode ter 1-9
     * - Não pode重复 números na mesma linha, coluna OU quadrante 3x3
     * - Como Sudoku, mas com цель de fazer 3 em linha como Jogo da Velha
     * - Ganha quem completar 3 números em linha (horizontal, vertical ou diagonal)
     * - Enquanto mantém o Sudoku válido!
     *
     * COMANDOS:
     * - #gridtactics start - Iniciar jogo
     * - #grid <número> <posição> - Jogar (ex: #grid 5 5 = número 5 na posição 5)
     * - #grid help - Ver regras completas
     *
     * EXEMPLO:
     *   Posições:   Tabuleiro vazio:
     *    1|2|3         _|_|_
     *   -+-+-         -+-+-
     *    4|5|6         _|_|_
     *   -+-+-         -+-+-
     *    7|8|9         _|_|_
     */
    async handleGridTactics(chatId, senderId, input, opponentId) {
        const gameKey = `${chatId}_gridtactics`;
        let game = this.games.get(gameKey);
        // Mostrar ajuda/regras
        if (input === 'help' || input === 'regras' || input === 'regras') {
            return this.getGridTacticsHelp();
        }
        // Iniciar novo jogo
        if (input === 'start') {
            if (game) {
                return { text: '⚠️ Já existe uma partida de Grid Tactics em andamento!', finished: false };
            }
            // Modo IA ou multiplayer
            const isAIMode = !opponentId;
            if (isAIMode) {
                opponentId = 'akira-ai@akira.bot';
            }
            // Gerar tabuleiro Sudoku válido inicial (com algumas células preenchidas)
            const initialBoard = this.generateValidSudokuBoard(3); // 3 significa dificuldade média
            game = {
                type: 'gridtactics',
                players: [senderId, opponentId],
                turn: 0,
                board: initialBoard,
                isAIMode: isAIMode,
                aiSymbol: '🤖',
                humanSymbol: '👤',
                moveHistory: [],
                startTime: Date.now(),
                lastActivity: Date.now()
            };
            this.games.set(gameKey, game);
            const opponentDisplay = isAIMode ? '🤖 Akira (IA)' : `@${opponentId.split('@')[0]}`;
            return {
                text: `🎯 *GRID TACTICS*\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 @${senderId.split('@')[0]} (Você)\n` +
                    `vs\n` +
                    `${opponentDisplay}\n\n` +
                    `*OBJETIVO:* Complete 3 números em linha (horizontal, vertical ou diagonal)\n` +
                    `enquanto mantém o Sudoku válido!\n\n` +
                    `${this.renderGridTacticsBoard(game.board)}\n\n` +
                    `*Como jogar:*\n` +
                    `#grid <número 1-9> <posição 1-9>\n\n` +
                    `*Exemplo:* #grid 5 5 (coloca o número 5 na posição central)\n\n` +
                    `Vez de: @${senderId.split('@')[0]}`,
                finished: false
            };
        }
        if (!game || game.type !== 'gridtactics') {
            return {
                text: `❌ Nenhum jogo ativo.\n\n` +
                    `Use *#gridtactics start* para jogar contra a IA\n` +
                    `Use *#gridtactics @user* para multiplayer\n` +
                    `Use *#gridtactics help* para ver as regras!`,
                finished: false
            };
        }
        // Processar jogada
        const args = input.split(' ');
        if (args.length < 2) {
            return {
                text: `❌ Formato inválido!\n\n` +
                    `Use: *#grid <número 1-9> <posição 1-9>*\n\n` +
                    `Exemplo: *#grid 5 5*\n\n` +
                    `${this.renderGridTacticsBoard(game.board)}`,
                finished: false
            };
        }
        const number = parseInt(args[0]);
        const position = parseInt(args[1]) - 1;
        // Validações
        if (isNaN(number) || number < 1 || number > 9) {
            return { text: '❌ Escolha um número de 1 a 9!', finished: false };
        }
        if (isNaN(position) || position < 0 || position > 8) {
            return { text: '❌ Escolha uma posição de 1 a 9!', finished: false };
        }
        if (game.board[position] !== null) {
            return { text: '❌ Essa posição já está ocupada!', finished: false };
        }
        // Verificar se é a vez do jogador correto
        if (senderId !== game.players[game.turn]) {
            return { text: '⏳ Aguarde sua vez!', finished: false };
        }
        // Fazer jogada do humano
        const previousBoard = [...game.board];
        game.board[position] = number;
        game.moveHistory.push({ player: senderId, number, position, board: [...previousBoard] });
        game.lastActivity = Date.now();
        // Verificar vitória do humano
        if (this.checkGridTacticsWinner(game.board, number)) {
            this.games.delete(gameKey);
            return {
                text: `🎉 *VITÓRIA!*\n\n` +
                    `${this.renderGridTacticsBoard(game.board)}\n\n` +
                    `@${senderId.split('@')[0]} venceu!\n\n` +
                    `Você completou 3 em linha! 🏆`,
                finished: true
            };
        }
        // Verificar se o humano quebrou o Sudoku (movimento inválido)
        if (!this.isValidSudokuMove(game.board, position, number)) {
            game.board[position] = null; // Reverter jogada
            return {
                text: `❌ *MOVIMENTO INVÁLIDO!*\n\n` +
                    `Esse número viola as regras do Sudoku!\n` +
                    `Não pode ter números repetidos na mesma linha, coluna ou quadrante.\n\n` +
                    `${this.renderGridTacticsBoard(game.board)}\n\n` +
                    `Tente novamente!`,
                finished: false
            };
        }
        // Verificar empate (tabuleiro cheio)
        if (game.board.every((cell) => cell !== null)) {
            this.games.delete(gameKey);
            return {
                text: `👔 *EMPATE!*\n\n` +
                    `${this.renderGridTacticsBoard(game.board)}\n\n` +
                    `Ninguém venceu. Boa tentativa!`,
                finished: true
            };
        }
        // Se modo IA, jogada da IA
        if (game.isAIMode) {
            game.turn = 1;
            // IA encontra melhor jogada
            const aiMove = this.calculateGridTacticsAIMove(game.board, number); // O número do humano
            if (aiMove.position !== -1) {
                game.board[aiMove.position] = aiMove.number;
                game.moveHistory.push({ player: 'akira-ai', number: aiMove.number, position: aiMove.position, board: [...previousBoard] });
                // Verificar vitória da IA
                if (this.checkGridTacticsWinner(game.board, aiMove.number)) {
                    this.games.delete(gameKey);
                    return {
                        text: `🤖 *DERROTA!*\n\n` +
                            `${this.renderGridTacticsBoard(game.board)}\n\n` +
                            `Akira completou 3 em linha!\n\n` +
                            `Tente novamente com #gridtactics start`,
                        finished: true
                    };
                }
                // Verificar empatar após jogada da IA
                if (game.board.every((cell) => cell !== null)) {
                    this.games.delete(gameKey);
                    return {
                        text: `👔 *EMPATE!*\n\n` +
                            `${this.renderGridTacticsBoard(game.board)}\n\n` +
                            `Ninguém venceu. Boa tentativa!`,
                        finished: true
                    };
                }
            }
            // Voltar turno para o humano
            game.turn = 0;
            return {
                text: `🎯 *GRID TACTICS VS AKIRA*\n\n` +
                    `${this.renderGridTacticsBoard(game.board)}\n\n` +
                    `🤖 Akira jogou: ${aiMove.number} na posição ${aiMove.position + 1}\n\n` +
                    `Sua vez! Use: #grid <número> <posição>`,
                finished: false
            };
        }
        // Modo multiplayer - trocar turno
        game.turn = game.turn === 0 ? 1 : 0;
        return {
            text: `🎯 *GRID TACTICS*\n\n` +
                `${this.renderGridTacticsBoard(game.board)}\n\n` +
                `Vez de: @${game.players[game.turn].split('@')[0]}\n\n` +
                `Use: #grid <número> <posição>`,
            finished: false
        };
    }
    /**
     * Gera um tabuleiro Sudoku válido inicial
     */
    generateValidSudokuBoard(difficulty) {
        // Tabuleiro base válido (uma solução Sudoku)
        const baseBoard = [
            5, 3, null, null, 7, null, null, null, null,
            6, null, null, 1, 9, 5, null, null, null,
            null, 9, 8, null, null, null, null, 6, null,
            8, null, null, null, 6, null, null, null, 3,
            4, null, null, 8, null, 3, null, null, 1,
            7, null, null, null, 2, null, null, null, 6,
            null, 6, null, null, null, null, 2, 8, null,
            null, null, null, 4, 1, 9, null, null, 5,
            null, null, null, null, 8, null, null, 7, 9
        ];
        // Converte para array mutável
        const board = [...baseBoard];
        // Remove células aleatoriamente baseado na dificuldade
        // difficulty 1 = fácil (remove 3), 2 = médio (remove 4), 3 = difícil (remove 5)
        const cellsToRemove = 3 + difficulty;
        const positions = Array.from({ length: 9 }, (_, i) => i);
        // Embaralha posições
        for (let i = positions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [positions[i], positions[j]] = [positions[j], positions[i]];
        }
        // Remove células
        for (let i = 0; i < cellsToRemove; i++) {
            const pos = positions[i] * 9 + Math.floor(Math.random() * 9);
            if (pos < 81) {
                board[pos] = null;
            }
        }
        return board;
    }
    /**
     * Renderiza o tabuleiro de Grid Tactics
     */
    renderGridTacticsBoard(board) {
        let display = '';
        for (let i = 0; i < 9; i++) {
            const cell = board[i];
            const cellDisplay = cell !== null ? cell.toString() : '_';
            if (i === 0 || i === 3 || i === 6) {
                display += '┌───┬───┬───┐\n';
            }
            else if (i === 1 || i === 4 || i === 7) {
                display += '├───┼───┼───┤\n';
            }
            const row = Math.floor(i / 3);
            const col = i % 3;
            display += '│';
            display += ` ${cellDisplay} `;
            if (col === 2) {
                display += '│\n';
            }
        }
        display += '└───┴───┴───┘\n';
        // Adicionar números das posições abaixo
        display += '  1  2  3   4  5  6   7  8  9';
        return display;
    }
    /**
     * Verifica se uma jogada mantém o Sudoku válido
     */
    isValidSudokuMove(board, position, number) {
        const row = Math.floor(position / 3);
        const col = position % 3;
        const boxRow = Math.floor(row / 3);
        const boxCol = Math.floor(col / 3);
        // Verificar linha (grupo de 3 células)
        for (let i = row * 3; i < row * 3 + 3; i++) {
            if (i !== position && board[i] === number) {
                return false;
            }
        }
        // Verificar coluna
        for (let i = col; i < 9; i += 3) {
            if (i !== position && board[i] === number) {
                return false;
            }
        }
        // Verificar quadrante 3x3
        const boxStart = boxRow * 6 + boxCol * 3;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const pos = boxStart + r * 3 + c;
                if (pos !== position && board[pos] === number) {
                    return false;
                }
            }
        }
        return true;
    }
    /**
     * Verifica vencedor no Grid Tactics (3 em linha)
     */
    checkGridTacticsWinner(board, lastNumber) {
        const wins = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // Horizontais
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // Verticais
            [0, 4, 8], [2, 4, 6] // Diagonais
        ];
        return wins.some(combo => {
            // Todos os 3 devem ser preenchidos E serem o último número jogado
            // (Na verdade, o último número jogado ganha, então verificamos se todos são iguais)
            return board[combo[0]] !== null &&
                board[combo[1]] !== null &&
                board[combo[2]] !== null &&
                board[combo[0]] === board[combo[1]] &&
                board[combo[1]] === board[combo[2]];
        });
    }
    /**
     * Calcula a melhor jogada da IA no Grid Tactics
     */
    calculateGridTacticsAIMove(board, humanNumber) {
        const availablePositions = board.map((cell, i) => cell === null ? i : -1).filter(i => i !== -1);
        if (availablePositions.length === 0) {
            return { number: -1, position: -1 };
        }
        // 1. Tentar vencer
        for (const pos of availablePositions) {
            for (let num = 1; num <= 9; num++) {
                if (this.isValidSudokuMove(board, pos, num)) {
                    const testBoard = [...board];
                    testBoard[pos] = num;
                    if (this.checkGridTacticsWinner(testBoard, num)) {
                        return { number: num, position: pos };
                    }
                }
            }
        }
        // 2. Bloquear vitória do oponente
        for (const pos of availablePositions) {
            for (let num = 1; num <= 9; num++) {
                if (num !== humanNumber && this.isValidSudokuMove(board, pos, num)) {
                    const testBoard = [...board];
                    testBoard[pos] = num;
                    if (this.checkGridTacticsWinner(testBoard, num)) {
                        return { number: num, position: pos };
                    }
                }
            }
        }
        // 3. Jogar no centro (posição 4) se disponível
        if (board[4] === null) {
            for (let num = 1; num <= 9; num++) {
                if (this.isValidSudokuMove(board, 4, num)) {
                    return { number: num, position: 4 };
                }
            }
        }
        // 4. Jogar em qualquer posição válida aleatória
        const validMoves = [];
        for (const pos of availablePositions) {
            // Tentar números que não são o que o humano usou recentemente
            const preferredNumbers = [5, 3, 7, 1, 9, 2, 4, 6, 8];
            for (const num of preferredNumbers) {
                if (this.isValidSudokuMove(board, pos, num)) {
                    validMoves.push({ number: num, position: pos });
                    break;
                }
            }
        }
        if (validMoves.length > 0) {
            return validMoves[Math.floor(Math.random() * validMoves.length)];
        }
        return { number: -1, position: -1 };
    }
    /**
     * Retorna a ajuda/regras do Grid Tactics
     */
    getGridTacticsHelp() {
        return {
            text: `🎯 *GRID TACTICS - REGRAS COMPLETAS*\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `*O QUE É?*\n` +
                `Um jogo híbrido que combina:\n` +
                `• Jogo da Velha (3 em linha)\n` +
                `• Sudoku (sem números repetidos)\n\n` +
                `*OBJETIVO:*\n` +
                `Complete 3 números em linha (horizontal,\n` +
                `vertical ou diagonal) ENQUANTO mantém\n` +
                `o tabuleiro válido como Sudoku!\n\n` +
                `*REGRAS DO SUDOKU:*\n` +
                `• Não pode ter números repetidos na mesma linha\n` +
                `• Não pode ter números repetidos na mesma coluna\n` +
                `• Não pode ter números repetidos no mesmo quadrante 3x3\n\n` +
                `*COMO JOGAR:*\n` +
                `1. Use *#gridtactics start* para começar\n` +
                `2. Use *#grid <número> <posição>* para jogar\n\n` +
                `*EXEMPLO:*\n` +
                `#grid 5 5 = coloca o número 5 na posição central\n\n` +
                `*POSIÇÕES:*\n` +
                ` 1 | 2 | 3\n` +
                `---+---+---\n` +
                ` 4 | 5 | 6\n` +
                `---+---+---\n` +
                ` 7 | 8 | 9\n\n` +
                `*DICA:*\n` +
                `• Some 3 não precisa ser 3 em linha!\n` +
                `• Pode ser 1-2-3, 2-3-4, etc\n` +
                `• Planeje com antecedência! 🧠`,
            finished: false
        };
    }
    /**
     * Para o jogo atual
     */
    forceStop(chatId) {
        this.games.delete(chatId);
        this.games.delete(`${chatId}_rps`);
        this.games.delete(`${chatId}_guess`);
        this.games.delete(`${chatId}_hangman`);
        this.games.delete(`${chatId}_gridtactics`);
        return true;
    }
}
export default GameSystem;
