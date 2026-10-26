// Uso: npm run migrar            → aplica as migrations pendentes
//      npm run migrar -- --status → apenas lista o que está pendente
const config = require('../config/ambiente');
const { aplicarMigracoes } = require('../db/migracoes');

async function principal() {
    const apenasStatus = process.argv.includes('--status');
    console.log(`Banco: ${config.db.nome} em ${config.db.host}:${config.db.porta}`);

    const { aplicadas, pendentes, alertas } = await aplicarMigracoes({
        apenasStatus,
        log: (mensagem) => console.log(mensagem)
    });

    for (const alerta of alertas) console.warn(`AVISO: ${alerta}`);
    if (apenasStatus) {
        console.log(pendentes.length > 0
            ? `Pendentes:\n- ${pendentes.join('\n- ')}`
            : 'Nenhuma migration pendente.');
        return;
    }
    console.log(aplicadas.length > 0
        ? `${aplicadas.length} migration(s) aplicada(s).`
        : 'Nenhuma migration pendente.');
}

principal().catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
});
