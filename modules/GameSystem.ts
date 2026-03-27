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
    private static instance: GameSystem;
    private games: Map<string, any> = new Map();

    private constructor() {
        // Inicialização se necessário
    }

    public static getInstance(): GameSystem {
        if (!GameSystem.instance) {
            GameSystem.instance = new GameSystem();
        }
        return GameSystem.instance;
    }

    /**
     * Normaliza IDs do WhatsApp removendo sufixos de dispositivo e domínios desnecessários
     * Formato final: número@s.whatsapp.net
     */
    private _normalizeId(id: string | null | undefined): string {
        if (!id) return '';
        const clean = id.split('@')[0].split(':')[0];
        return `${clean.replace(/\D/g, '')}@s.whatsapp.net`;
    }

    /**
     * Remove duplicatas e limpa o map de jogos periodicamente
     */
    private cleanupGames() {
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
    public async handleGame(chatId: string, senderId: string, command: string, args: string[], opponentId?: string): Promise<{ text: string, finished?: boolean }> {
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
    public async processActiveGameInput(chatId: string, senderId: string, input: string, replyInfo?: any): Promise<{ text: string, finished: boolean } | null> {
        this.cleanupGames();
        const texto = (input || '').trim().toLowerCase();
        const normSender = this._normalizeId(senderId);

        // Se for reply a uma mensagem específica de jogo, priorizamos o tipo detectado
        if (replyInfo?.isReplyToGame) {
            const gType = replyInfo.gameType;
            if (gType === 'ttt' && /^[1-9]$/.test(texto)) {
                return await this.handleTicTacToe(chatId, senderId, texto);
            }
        }

        // Tic-Tac-Toe
        let game = this.games.get(chatId);
        if (game && game.type === 'ttt') {
            // RESTRIÇÃO: Apenas jogadores ativos podem interagir
            if (!game.players.includes(normSender)) return null;

            if (/^[1-9]$/.test(texto)) {
                return await this.handleTicTacToe(chatId, senderId, texto);
            }
            if (['reset', 'reiniciar', 'fechar', 'sair', 'stop'].includes(texto)) {
                return await this.handleTicTacToe(chatId, senderId, texto);
            }
        }

        // RPS (Pedra, Papel, Tesoura)
        game = this.games.get(`${chatId}_rps`);
        if (game && game.type === 'rps' && game.players.includes(normSender)) {
            if (['pedra', 'papel', 'tesoura'].includes(texto)) {
                return await this.handleRPS(chatId, senderId, texto);
            }
        }

        // Guess
        game = this.games.get(`${chatId}_guess`);
        if (game && game.type === 'guess' && game.player === normSender && /^\d+$/.test(texto)) {
            return await this.handleGuess(chatId, senderId, texto);
        }

        return null;
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * JOGO DA VELHA (TIC-TAC-TOE) - AGORA COM MODO IA!
     * ═══════════════════════════════════════════════════════════════════════
     */
    public async handleTicTacToe(chatId: string, senderId: string, input: string, opponentId?: string): Promise<{ text: string, finished: boolean }> {
        let game = this.games.get(chatId);

        // Use helper for robust normalization
        const normalizedSenderId = this._normalizeId(senderId);
        let normalizedOpponentId = opponentId ? this._normalizeId(opponentId) : undefined;

        // Comandos de controle
        if (game && game.type === 'ttt') {
            const lowInput = input.toLowerCase();
            if (['fechar', 'sair', 'stop'].includes(lowInput)) {
                this.games.delete(chatId);
                return { text: '🚪 Partida de Jogo da Velha encerrada!', finished: true };
            }
            if (['reset', 'reiniciar'].includes(lowInput)) {
                const p1 = game.players[0];
                const p2 = game.players[1];
                const isAI = game.isAIMode;
                this.games.delete(chatId);
                return await this.handleTicTacToe(chatId, p1, 'start', isAI ? undefined : p2);
            }
        }

        // Iniciar novo jogo - AGORA SUPORTA MODO IA
        if (input === 'start' || (!game && normalizedOpponentId)) {
            if (game) {
                return { text: '⚠️ Já existe uma partida em andamento neste chat!', finished: false };
            }

            // MODO IA: Se não mencionar ninguém, joga contra a Akira
            const isAIMode = !normalizedOpponentId;
            if (isAIMode) {
                normalizedOpponentId = 'akira-ai@akira.bot'; // ID especial para IA
            } else if (!normalizedOpponentId) {
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
        if (game.board.every((cell: any) => cell !== null)) {
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
                if (game.board.every((cell: any) => cell !== null)) {
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
    private calculateAIMove(board: any[], aiSymbol: string, humanSymbol: string): number {
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

    private renderBoard(board: any[]): string {
        const numMap = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
        const b = board.map((cell, i) => cell || numMap[i]);

        return `    ┏━━━━━┳━━━━━┳━━━━━┓\n` +
            `    ┃  ${b[0]}  ┃  ${b[1]}  ┃  ${b[2]}  ┃\n` +
            `    ┣━━━━━╋━━━━━╋━━━━━┫\n` +
            `    ┃  ${b[3]}  ┃  ${b[4]}  ┃  ${b[5]}  ┃\n` +
            `    ┣━━━━━╋━━━━━╋━━━━━┫\n` +
            `    ┃  ${b[6]}  ┃  ${b[7]}  ┃  ${b[8]}  ┃\n` +
            `    ┗━━━━━┻━━━━━┻━━━━━┛`;
    }

    private checkWinner(board: any[]): boolean {
        const wins = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // Horizontais
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // Verticais
            [0, 4, 8], [2, 4, 6]             // Diagonais
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
    public async handleRPS(chatId: string, senderId: string, input: string, opponentId?: string): Promise<{ text: string, finished: boolean }> {
        const choices = ['pedra', 'papel', 'tesoura'];
        const emojis: any = { pedra: '🪨', papel: '📄', tesoura: '✂️' };
        const beats: any = { pedra: 'tesoura', papel: 'pedra', tesoura: 'papel' };

        const gameKey = `${chatId}_rps`;
        let game = this.games.get(gameKey);

        const normSender = this._normalizeId(senderId);

        // Comandos de controle
        if (game && game.type === 'rps') {
            const lowInput = input.trim().toLowerCase();
            if (['sair', 'fechar', 'stop'].includes(lowInput)) {
                this.games.delete(gameKey);
                return { text: '🚪 Jogo de Pedra, Papel e Tesoura encerrado.', finished: true };
            }
            if (['reset', 'reiniciar'].includes(lowInput)) {
                const p1 = game.players[0];
                const p2 = game.players[1];
                const isAI = game.isAIMode;
                this.games.delete(gameKey);
                return await this.handleRPS(chatId, p1, 'start', isAI ? undefined : p2);
            }
        }

        // Iniciar novo jogo
        if (input === 'start' || (!game && opponentId)) {
            if (game) {
                return { text: '⚠️ Já existe uma partida em andamento! Digite *sair* para fechar.', finished: false };
            }

            const isAIMode = !opponentId;
            const normOpponent = opponentId ? this._normalizeId(opponentId) : 'akira-ai@akira.bot';

            game = {
                type: 'rps',
                players: [normSender, normOpponent],
                choices: [null, null],
                waitingFor: normSender,
                isAIMode: isAIMode,
                startTime: Date.now(),
                lastActivity: Date.now()
            };

            this.games.set(gameKey, game);

            const oppName = isAIMode ? '🤖 *Akira (IA)*' : `@${normOpponent.split('@')[0]}`;

            return {
                text: `🪨📄✂️ *DESAFIO RPS INICIADO!*\n\n` +
                    `👤 @${normSender.split('@')[0]} vs ${oppName}\n\n` +
                    `👉 Vez de: @${normSender.split('@')[0]}\n` +
                    `💡 Escolha: *pedra*, *papel* ou *tesoura*`,
                finished: false
            };
        }

        if (!game || game.type !== 'rps') {
            return { text: '❌ Nenhum jogo ativo. Use #rps @user ou #rps start para jogar contra mim.', finished: false };
        }

        // Validar escolha
        const choice = input.toLowerCase().trim();
        if (!choices.includes(choice)) {
            return { text: '❌ Escolha inválida! Use: *pedra*, *papel* ou *tesoura*.', finished: false };
        }

        // Determinar índice do jogador
        const playerIndex = normSender === game.players[0] ? 0 : (normSender === game.players[1] ? 1 : -1);

        if (playerIndex === -1) return { text: '❌ Você não participa desta partida!', finished: false };
        if (normSender !== game.waitingFor) return { text: '⏳ Aguarde sua vez!', finished: false };

        // Registrar escolha
        game.choices[playerIndex] = choice;
        game.lastActivity = Date.now();

        // Se for modo IA, a IA escolhe agora
        if (game.isAIMode) {
            const aiChoice = choices[Math.floor(Math.random() * choices.length)];
            game.choices[1] = aiChoice;
        }

        // Se alguém ainda não escolheu (multiplayer)
        if (game.choices[0] === null || game.choices[1] === null) {
            const nextPlayer = game.players[1];
            game.waitingFor = nextPlayer;
            return {
                text: `✅ Escolha registrada!\n\n👉 Vez de: @${nextPlayer.split('@')[0]}\n💡 Digite sua escolha agora.`,
                finished: false
            };
        }

        // Ambos escolheram - Resultado
        const c1 = game.choices[0];
        const c2 = game.choices[1];
        let resText = '';
        let winnerIndex = -1;

        if (c1 === c2) {
            resText = '🤝 *EMPATE TÉCNICO!*';
        } else if (beats[c1] === c2) {
            resText = `🏆 *@${game.players[0].split('@')[0]} VENCEU!*`;
            winnerIndex = 0;
        } else {
            const name = game.isAIMode ? 'Akira' : `@${game.players[1].split('@')[0]}`;
            resText = `🏆 *${name} VENCEU!*`;
            winnerIndex = 1;
        }

        this.games.delete(gameKey);

        return {
            text: `🪨📄✂️ *PEDRA, PAPEL E TESOURA*\n\n` +
                `👤 @${game.players[0].split('@')[0]}: ${emojis[c1]} *${c1.toUpperCase()}*\n` +
                `🤖 ${game.isAIMode ? 'Akira' : '@' + game.players[1].split('@')[0]}: ${emojis[c2]} *${c2.toUpperCase()}*\n\n` +
                `${resText}\n\n` +
                `_${winnerIndex === 0 ? 'Parabéns!' : (winnerIndex === 1 ? 'Melhor sorte na próxima.' : 'Ninguém ganhou.')}_`,
            finished: true
        };
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * ADVINHA O NÚMERO (GUESS THE NUMBER)
     * ═══════════════════════════════════════════════════════════════════════
     */
    public async handleGuess(chatId: string, senderId: string, input: string): Promise<{ text: string, finished: boolean }> {
        const gameKey = `${chatId}_guess`;
        let game = this.games.get(gameKey);

        const normSender = this._normalizeId(senderId);

        // Comandos de controle
        if (game && game.type === 'guess') {
            const lowInput = input.trim().toLowerCase();
            if (['sair', 'fechar', 'stop'].includes(lowInput)) {
                this.games.delete(gameKey);
                return { text: '🚪 O jogo de adivinhação foi encerrado.', finished: true };
            }
            if (['reset', 'reiniciar'].includes(lowInput)) {
                this.games.delete(gameKey);
                return await this.handleGuess(chatId, normSender, 'start');
            }
        }

        // Iniciar novo jogo
        if (input === 'start') {
            if (game) {
                return { text: '⚠️ Já existe um desafio ativo! Digite apenas o número ou *sair*.', finished: false };
            }

            const targetNumber = Math.floor(Math.random() * 100) + 1;

            game = {
                type: 'guess',
                player: normSender,
                target: targetNumber,
                attempts: 0,
                maxAttempts: 10,
                startTime: Date.now(),
                lastActivity: Date.now()
            };

            this.games.set(gameKey, game);
            return {
                text: `🔢 *ADVINHA O NÚMERO!* 🔢\n\n` +
                    `🤔 Pensei em um número entre *1 e 100*.\n` +
                    `🎯 Você tem *10 tentativas*.\n\n` +
                    `💡 Digite um número para tentar!`,
                finished: false
            };
        }

        if (!game || game.type !== 'guess') {
            return { text: '❌ Nenhum jogo ativo. Use #guess start para começar.', finished: false };
        }

        if (normSender !== game.player) {
            return { text: '❌ Este jogo é de outro usuário! Use #guess start para criar o seu.', finished: false };
        }

        const guess = parseInt(input.trim());
        if (isNaN(guess) || guess < 1 || guess > 100) {
            return { text: '❌ Inválido! Escolha um número entre *1 e 100*.', finished: false };
        }

        game.attempts++;
        game.lastActivity = Date.now();

        if (guess === game.target) {
            this.games.delete(gameKey);
            const medal = game.attempts <= 3 ? '🥇' : (game.attempts <= 6 ? '🥈' : '🥉');
            return {
                text: `🎉 *PARABÉNS! VOCÊ ACERTOU!* 🎉\n\n` +
                    `🎯 O número era: *${game.target}*\n` +
                    `📊 Tentativas: *${game.attempts}/${game.maxAttempts}*\n` +
                    `🏆 Ranking: ${medal}\n\n` +
                    `_Incrível! Quer jogar de novo?_`,
                finished: true
            };
        }

        if (game.attempts >= game.maxAttempts) {
            this.games.delete(gameKey);
            return {
                text: `😞 *GAME OVER* 😞\n\n` +
                    `O número secreto era: *${game.target}*\n` +
                    `Você esgotou todas as tentativas.\n\n` +
                    `_Tente novamente! Digite #guess start_`,
                finished: true
            };
        }

        // Dicas dinâmicas
        const diff = Math.abs(guess - game.target);
        let heat = '';
        if (diff <= 5) heat = '🔥 *MUITO QUENTE!*';
        else if (diff <= 15) heat = '🌞 *ESTÁ ESQUENTANDO...*';
        else if (diff <= 30) heat = '⛅ *ESTÁ MORNO.*';
        else heat = '❄️ *FRIO...*';

        const direction = guess < game.target ? '🔼 Tente um MAIOR' : '🔽 Tente um MENOR';

        // Barra de progresso visual
        const prog = '🟥'.repeat(game.attempts) + '⬜'.repeat(game.maxAttempts - game.attempts);

        return {
            text: `❌ *ERROU!* ❌\n\n` +
                `${heat}\n` +
                `${direction}\n\n` +
                `📊 Tentativas: [${prog}] *${game.attempts}/${game.maxAttempts}*`,
            finished: false
        };
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * FORCA (HANGMAN)
     * ═══════════════════════════════════════════════════════════════════════
     */
    private words = [
        'akira', 'computador', 'teclado', 'monitor', 'celular', 'whatsapp',
        'programacao', 'typescript', 'javascript', 'internet', 'algoritmo',
        'software', 'hardware', 'servidor', 'banco', 'futebol', 'angola',
        'luanda', 'escola', 'universo', 'galaxia', 'planeta', 'estrela',
        'tecnologia', 'inteligencia', 'artificial', 'projeto', 'sistema'
    ];

    public async handleHangman(chatId: string, senderId: string, input: string, customWord?: string): Promise<{ text: string, finished: boolean }> {
        const gameKey = `${chatId}_hangman`;
        let game = this.games.get(gameKey);

        const normSender = this._normalizeId(senderId);

        // Comandos de controle
        if (game && game.type === 'hangman') {
            const lowInput = input.trim().toLowerCase();
            if (['sair', 'fechar', 'stop'].includes(lowInput)) {
                this.games.delete(gameKey);
                return { text: '🚪 O jogo da forca foi encerrado.', finished: true };
            }
            if (['reset', 'reiniciar'].includes(lowInput)) {
                this.games.delete(gameKey);
                return await this.handleHangman(chatId, normSender, 'start');
            }
        }

        // Iniciar novo jogo
        if (input === 'start' || (!game && customWord)) {
            if (game) {
                return { text: '⚠️ Já existe uma forca ativa! Digite as letras ou *sair*.', finished: false };
            }

            const word = (customWord && customWord.length > 2)
                ? customWord.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '')
                : this.words[Math.floor(Math.random() * this.words.length)];

            game = {
                type: 'hangman',
                player: normSender,
                word: word,
                guessed: new Set<string>(),
                wrong: 0,
                maxWrong: 6,
                startTime: Date.now(),
                lastActivity: Date.now()
            };

            this.games.set(gameKey, game);
            return {
                text: `🔤 *JOGO DA FORCA INICIADO!* 🔤\n\n` +
                    this.getHangmanDisplay(game) +
                    `\n\n💡 Digite uma letra para chutar!`,
                finished: false
            };
        }

        if (!game || game.type !== 'hangman') {
            return { text: '❌ Nenhum jogo ativo. Use #forca start para começar.', finished: false };
        }

        if (normSender !== game.player) {
            return { text: '❌ Este jogo é de outro usuário! Use #forca start para criar o seu.', finished: false };
        }

        // Processar tentativa (letra única)
        const guess = input.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0);

        if (!guess || !/[a-z]/.test(guess)) {
            return { text: '❌ Inválido! Digite apenas uma letra de A a Z.', finished: false };
        }

        if (game.guessed.has(guess)) {
            return { text: '⚠️ Você já tentou essa letra!', finished: false };
        }

        game.guessed.add(guess);
        game.lastActivity = Date.now();

        // Verificar se a letra está na palavra
        if (game.word.includes(guess)) {
            const won = game.word.split('').every((letter: string) => game.guessed.has(letter));

            if (won) {
                this.games.delete(gameKey);
                return {
                    text: `🎉 *PARABÉNS! VOCÊ VENCEU!* 🎉\n\n` +
                        `A palavra era: *${game.word.toUpperCase()}*\n` +
                        `💀 Erros: *${game.wrong}/${game.maxWrong}*\n\n` +
                        `_Ufa! Você escapou da forca!_`,
                    finished: true
                };
            }

            return {
                text: `✅ Letra *${guess.toUpperCase()}* está correta!\n\n` +
                    this.getHangmanDisplay(game),
                finished: false
            };
        }

        // Letra errada
        game.wrong++;

        if (game.wrong >= game.maxWrong) {
            this.games.delete(gameKey);
            return {
                text: `😵 *VOCÊ FOI ENFORCADO!* 😵\n\n` +
                    this.getHangmanDisplay(game) +
                    `\n\n❌ A palavra secreta era: *${game.word.toUpperCase()}*\n` +
                    `_Tente novamente! Digite #forca start_`,
                finished: true
            };
        }

        return {
            text: `❌ Letra *${guess.toUpperCase()}* não existe!\n\n` +
                this.getHangmanDisplay(game),
            finished: false
        };
    }

    private getHangmanDisplay(game: any): string {
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
        const display = game.word.split('').map((letter: string) =>
            game.guessed.has(letter) ? letter : '_'
        ).join(' ');

        return `🪢 *FORCA*\n\n` +
            `${hangmanStages[game.wrong]}\n\n` +
            `Palavra: *${display}*\n\n` +
            `Erros: ${game.wrong}/${game.maxWrong}\n` +
            `Letras usadas: ${[...game.guessed].join(', ')}\n\n` +
            `Use: *#forca <letra>*`;
    }



    /**
     * ═══════════════════════════════════════════════════════════════════════
     * BLACKJACK (21)
     * ═══════════════════════════════════════════════════════════════════════
     */
    public async handleBlackjack(chatId: string, senderId: string, input: string): Promise<{ text: string, finished: boolean }> {
        const gameKey = `${chatId}_blackjack`;
        let game = this.games.get(gameKey);

        const normSender = this._normalizeId(senderId);

        // Iniciar novo jogo
        if (input === 'start') {
            if (game) return { text: '⚠️ Já existe um Blackjack ativo! Digite *puxar*, *parar* ou *sair*.', finished: false };

            const deck = this.generateDeck();
            const playerHand = [this.drawCard(deck), this.drawCard(deck)];
            const aiHand = [this.drawCard(deck), this.drawCard(deck)];

            game = {
                type: 'blackjack',
                player: normSender,
                playerHand,
                aiHand,
                deck,
                status: 'playing',
                startTime: Date.now(),
                lastActivity: Date.now()
            };

            this.games.set(gameKey, game);

            const pScore = this.calculateBJScore(playerHand);
            if (pScore === 21) {
                return this.resolveBlackjack(chatId, game, 'BLACKJACK! 🃏');
            }

            return {
                text: `🃏 *BLACKJACK (21)* 🃏\n\n` +
                    `👤 *Sua Mão:* ${this.renderHand(playerHand)} (${pScore})\n` +
                    `🤖 *Banca:* ${this.renderHand([aiHand[0]], true)} (?)\n\n` +
                    `💡 O que deseja fazer?\n` +
                    `👉 *#bj puxar* (pegar carta)\n` +
                    `👉 *#bj parar* (encerrar vez)\n` +
                    `👉 *#bj sair* (desistir)`,
                finished: false
            };
        }

        if (!game || game.type !== 'blackjack') return { text: '❌ Nenhum jogo ativo. Use #blackjack start para começar.', finished: false };
        if (normSender !== game.player) return { text: '❌ Este jogo não é seu!', finished: false };

        const action = input.trim().toLowerCase();

        if (action === 'puxar' || action === 'hit') {
            const card = this.drawCard(game.deck);
            game.playerHand.push(card);
            const score = this.calculateBJScore(game.playerHand);

            if (score > 21) {
                return this.resolveBlackjack(chatId, game, 'ESTOUROU! 💥');
            }

            return {
                text: `🃏 *BLACKJACK - PUXOU* 🃏\n\n` +
                    `👤 *Sua Mão:* ${this.renderHand(game.playerHand)} (${score})\n` +
                    `🤖 *Banca:* ${this.renderHand([game.aiHand[0]], true)} (?)\n\n` +
                    `👉 *puxar* ou *parar*?`,
                finished: false
            };
        }

        if (action === 'parar' || action === 'stand') {
            // Turno da Banca (IA)
            let aiScore = this.calculateBJScore(game.aiHand);
            while (aiScore < 17) {
                game.aiHand.push(this.drawCard(game.deck));
                aiScore = this.calculateBJScore(game.aiHand);
            }
            return this.resolveBlackjack(chatId, game);
        }

        if (['sair', 'fechar', 'stop'].includes(action)) {
            this.games.delete(gameKey);
            return { text: '👋 Você saiu da mesa de Blackjack.', finished: true };
        }

        return { text: '❌ Use: *puxar* ou *parar*.', finished: false };
    }

    private generateDeck(): any[] {
        const suits = ['♠️', '♥️', '♦️', '♣️'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const deck = [];
        for (const s of suits) {
            for (const r of ranks) {
                deck.push({ rank: r, suit: s });
            }
        }
        return deck.sort(() => Math.random() - 0.5);
    }

    private drawCard(deck: any[]): any {
        return deck.pop();
    }

    private calculateBJScore(hand: any[]): number {
        let score = 0;
        let aces = 0;
        for (const card of hand) {
            if (card.rank === 'A') {
                aces++;
                score += 11;
            } else if (['J', 'Q', 'K'].includes(card.rank)) {
                score += 10;
            } else {
                score += parseInt(card.rank);
            }
        }
        while (score > 21 && aces > 0) {
            score -= 10;
            aces--;
        }
        return score;
    }

    private renderHand(hand: any[], hidden: boolean = false): string {
        let res = hand.map(c => `[${c.rank}${c.suit}]`).join(' ');
        if (hidden) res += ' [❓]';
        return res;
    }

    private resolveBlackjack(chatId: string, game: any, specialMsg?: string): { text: string, finished: boolean } {
        const pScore = this.calculateBJScore(game.playerHand);
        const aiScore = this.calculateBJScore(game.aiHand);
        let resultMsg = '';

        if (pScore > 21) {
            resultMsg = '❌ Você estourou e perdeu!';
        } else if (aiScore > 21) {
            resultMsg = '🎉 A banca estourou! VOCÊ VENCEU! 🏆';
        } else if (pScore > aiScore) {
            resultMsg = '🎉 Você venceu a banca! 🏆';
        } else if (pScore < aiScore) {
            resultMsg = '❌ A banca venceu. Mais sorte na próxima!';
        } else {
            resultMsg = '🤝 Empate! O valor volta para você.';
        }

        this.games.delete(`${chatId}_blackjack`);

        return {
            text: `🃏 *FIM DE JOGO* 🃏\n\n` +
                `${specialMsg ? '* ' + specialMsg + ' *\n\n' : ''}` +
                `👤 *Sua Mão:* ${this.renderHand(game.playerHand)} (*${pScore}*)\n` +
                `🤖 *Banca:* ${this.renderHand(game.aiHand)} (*${aiScore}*)\n\n` +
                `${resultMsg}`,
            finished: true
        };
    }

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * ROLETA RUSSA
     * ═══════════════════════════════════════════════════════════════════════
     */
    public async handleRussianRoulette(chatId: string, senderId: string, input: string): Promise<{ text: string, finished: boolean }> {
        const gameKey = `${chatId}_roulette`;
        let game = this.games.get(gameKey);

        const normSender = this._normalizeId(senderId);

        if (input === 'start') {
            if (game) return { text: '⚠️ Já há um tambor girado! Puxe o gatilho.', finished: false };

            game = {
                type: 'roulette',
                bullet: Math.floor(Math.random() * 6) + 1,
                current: 1,
                player: normSender,
                startTime: Date.now()
            };

            this.games.set(gameKey, game);
            return {
                text: `🔫 *ROLETA RUSSA* 🔫\n\n` +
                    `O tambor foi girado...\n` +
                    `Uma bala foi colocada em uma das 6 câmaras.\n\n` +
                    `👉 *#roleta puxar* para arriscar a sorte!`,
                finished: false
            };
        }

        if (!game || game.type !== 'roulette') return { text: '❌ Use #roleta start para começar.', finished: false };

        if (input.trim().toLowerCase() === 'puxar' || input.trim().toLowerCase() === 'shoot') {
            const hit = game.current === game.bullet;
            const chamber = game.current;
            game.current++;

            if (hit) {
                this.games.delete(gameKey);
                return {
                    text: `💥 *POOOW!* 💀\n\n` +
                        `A bala estava na câmara *${chamber}*.\n` +
                        `@${normSender.split('@')[0]} não teve sorte hoje...`,
                    finished: true
                };
            }

            if (game.current > 6) {
                this.games.delete(gameKey);
                return { text: '🍀 *CLIC!* O tambor acabou. Você sobreviveu! 🏆', finished: true };
            }

            return {
                text: `🍀 *CLIC!* \n\n` +
                    `Câmara ${chamber} estava vazia.\n` +
                    `Ainda restam ${6 - chamber} chances.\n\n` +
                    `👉 *puxar* de novo?`,
                finished: false
            };
        }

        if (['sair', 'fechar'].includes(input.toLowerCase())) {
            this.games.delete(gameKey);
            return { text: '🚶 Você guardou a arma e saiu.', finished: true };
        }

        return { text: '❌ Use: *puxar* ou *sair*.', finished: false };
    }

    /**
     * Para o jogo atual
     */
    public forceStop(chatId: string): boolean {
        this.games.delete(chatId);
        this.games.delete(`${chatId}_rps`);
        this.games.delete(`${chatId}_guess`);
        this.games.delete(`${chatId}_hangman`);
        this.games.delete(`${chatId}_blackjack`);
        this.games.delete(`${chatId}_roulette`);
        this.games.delete(`${chatId}_gridtactics`);
        return true;
    }
}

export default GameSystem.getInstance();

