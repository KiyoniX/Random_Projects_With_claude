"""Pont vers REA sous WSL : garde un serveur MCP de REA ouvert (un seul import Ghidra par module) et le sert sur un port local.

Sans lui, chaque commande « rea » en ligne refait l'import et l'analyse (plus de deux minutes) ; avec lui, une
question prend une quinzaine de secondes. Voir REA.md pour l'installation côté Ubuntu.

    python rea_bridge.py serve [--port N] [VAR=valeur ...]     lance REA et écoute ; les VAR vont dans son environnement
    python rea_bridge.py call <outil> '<arguments JSON>'       appelle un outil, affiche son résultat
        [--port N] [--save DOSSIER ETIQUETTE] [--max N]        --save range la réponse entière, le pseudo-code en .c, l'assembleur en .asm
    python rea_bridge.py tools [motif]                         liste les outils de REA
    python rea_bridge.py stop [--port N]

Exemple, pour un module dont les noms sont déjà dans fiches/sm.noms.tsv :

    python rea_bridge.py serve REA_GHIDRA_SEED_FILE=C:/.../decompil-3ds/fiches/sm.noms.tsv
    python rea_bridge.py call open_binary '{"path": "/mnt/c/.../local/extrait/sm/exefs/code.elf", "provider_id": "ghidra"}'
    python rea_bridge.py call procedure_pseudo_code '{"procedure": "0x1000a0"}' --save local/analyse/sm service_loop

Les chemins donnés à REA sont ceux d'Ubuntu (/mnt/c/...). Le langage ARM v6 est imposé : ce pont ne sert qu'aux binaires 3DS.
"""
import json
import os
import socket
import subprocess
import sys
import threading

DEFAULT_PORT = 47631
BASE_ENV = ['GHIDRA_INSTALL_DIR=/opt/ghidra', 'REA_GHIDRA_LANGUAGE_ID=ARM:LE:32:v6',
            'REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000', 'GHIDRA_HEADLESS_MAXMEM=4G']


def to_wsl_path(path):
    """C:\\dossier\\fichier -> /mnt/c/dossier/fichier."""
    path = os.path.abspath(path)
    return '/mnt/' + path[0].lower() + path[2:].replace('\\', '/')


def wsl_env_value(assignment):
    """VAR=valeur avec un chemin Windows -> VAR=/mnt/... .

    Lancé depuis Git Bash, « VAR=/mnt/c/... » arrive réécrit par MSYS en « VAR=C:/Program Files/Git/mnt/c/... » : REA
    refuse alors le chemin (« must be absolute ») et s'arrête. On reprend la partie /mnt/..., et un chemin Windows
    ordinaire (C:\\... ou C:/...) est converti."""
    name, sep, value = assignment.partition('=')
    if not sep or len(value) < 3 or value[1] != ':' or value[2] not in '\\/':
        return assignment
    plain = value.replace('\\', '/')
    if '/mnt/' in plain:
        return name + '=' + plain[plain.index('/mnt/'):]
    return name + '=' + to_wsl_path(value)


def serve(port, extra_env):
    extra_env = [wsl_env_value(item) for item in extra_env]
    command = ['wsl.exe', '-d', 'Ubuntu', '--', 'env'] + BASE_ENV + extra_env + ['rea', 'mcp']
    # Ce que REA écrit sur sa sortie d'erreur est gardé : sans cela, un REA qui s'arrête au démarrage ne laisse
    # qu'un « OSError » du pont, sans raison.
    log_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'local', 'analyse',
                            'rea_bridge_%d.log' % port)
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    log = open(log_path, 'wb')
    print('journal de REA :', log_path, flush=True)
    server = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log)
    replies, write_lock, reply_arrived = {}, threading.Lock(), threading.Condition()
    next_id = [0]

    def read_replies():
        for line in server.stdout:
            try:
                message = json.loads(line.decode('utf-8'))
            except ValueError:
                continue
            if 'id' in message and ('result' in message or 'error' in message):
                with reply_arrived:
                    replies[message['id']] = message
                    reply_arrived.notify_all()

    def send(message):
        with write_lock:
            try:
                server.stdin.write((json.dumps(message) + '\n').encode('utf-8'))
                server.stdin.flush()
            except OSError:
                log.flush()
                with open(log_path, 'rb') as f:
                    tail = f.read()[-2000:].decode('utf-8', 'replace')
                sys.exit('REA s\'est arrêté (code %s). Fin de son journal :\n%s' % (server.poll(), tail))

    def request(method, params, timeout=1800):
        with write_lock:
            next_id[0] += 1
            request_id = next_id[0]
        send({'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': params})
        with reply_arrived:
            if not reply_arrived.wait_for(lambda: request_id in replies, timeout=timeout):
                return {'error': {'message': 'pas de réponse en %d s' % timeout}}
            return replies.pop(request_id)

    threading.Thread(target=read_replies, daemon=True).start()
    hello = request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
                                   'clientInfo': {'name': 'rea_bridge', 'version': '1'}}, 120)
    send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
    print('serveur :', json.dumps(hello.get('result', hello).get('serverInfo', hello), ensure_ascii=False), flush=True)

    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('127.0.0.1', port))
    listener.listen(4)
    print('écoute sur', port, flush=True)
    while True:
        connection, _ = listener.accept()
        with connection:
            data = b''
            while not data.endswith(b'\n'):
                chunk = connection.recv(65536)
                if not chunk:
                    break
                data += chunk
            try:
                query = json.loads(data.decode('utf-8'))
            except ValueError:
                continue
            if query.get('method') == 'stop':
                connection.sendall(b'{"ok": true}\n')
                break
            reply = request(query['method'], query.get('params', {}))
            connection.sendall((json.dumps(reply, ensure_ascii=False) + '\n').encode('utf-8'))
    server.terminate()


def ask(method, params=None, port=DEFAULT_PORT):
    """Une requête MCP brute au pont ; rend la réponse JSON-RPC entière."""
    connection = socket.create_connection(('127.0.0.1', port))
    connection.sendall((json.dumps({'method': method, 'params': params or {}}) + '\n').encode('utf-8'))
    data = b''
    while not data.endswith(b'\n'):
        chunk = connection.recv(1 << 20)
        if not chunk:
            break
        data += chunk
    connection.close()
    return json.loads(data.decode('utf-8'))


def call_tool_text(name, arguments=None, port=DEFAULT_PORT):
    """Appelle un outil de REA ; rend le texte de sa réponse (du JSON la plupart du temps)."""
    reply = ask('tools/call', {'name': name, 'arguments': arguments or {}}, port)
    if 'error' in reply:
        raise RuntimeError(json.dumps(reply['error'], ensure_ascii=False))
    return '\n'.join(part.get('text', '') for part in reply['result'].get('content', []) if part.get('type') == 'text')


def parse_result(text):
    """La partie utile d'une réponse de REA : son résultat normalisé, ou le texte tel quel."""
    try:
        answer = json.loads(text, strict=False)
    except ValueError:
        return text
    if isinstance(answer, dict) and 'error' in answer and 'normalized_result' not in answer:
        raise RuntimeError(json.dumps(answer['error'], ensure_ascii=False))
    if isinstance(answer, dict):
        for key in ('normalized_result', 'raw_result', 'result'):
            if answer.get(key) is not None:
                return answer[key]
    return answer


def call_tool(name, arguments=None, port=DEFAULT_PORT):
    """Appelle un outil de REA ; rend son résultat normalisé."""
    return parse_result(call_tool_text(name, arguments, port))


def list_tools(port=DEFAULT_PORT):
    tools, cursor = [], None
    while True:
        page = ask('tools/list', {'cursor': cursor} if cursor else {}, port)['result']
        tools += page['tools']
        cursor = page.get('nextCursor')
        if not cursor:
            return tools


def pop_option(args, name, count=1):
    """Retire « name v1 [v2] » de args et rend les valeurs, ou None."""
    if name not in args:
        return None
    index = args.index(name)
    values = args[index + 1:index + 1 + count]
    del args[index:index + 1 + count]
    return values


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    port = int((pop_option(args, '--port') or [DEFAULT_PORT])[0])
    if not args:
        print(__doc__)
    elif args[0] == 'serve':
        serve(port, args[1:])
    elif args[0] == 'stop':
        print(ask('stop', port=port))
    elif args[0] == 'tools':
        for tool in list_tools(port):
            if len(args) < 2 or args[1].lower() in (tool['name'] + ' ' + tool.get('description', '')).lower():
                print('%-34s %s' % (tool['name'], tool.get('description', '').split('\n')[0][:110]))
    elif args[0] == 'call':
        save = pop_option(args, '--save', 2)
        limit = int((pop_option(args, '--max') or [4000])[0])
        text = call_tool_text(args[1], json.loads(args[2]) if len(args) > 2 else {}, port)
        try:
            result = parse_result(text)
        except RuntimeError as error:
            sys.exit('REA refuse : %s' % error)
        if save:
            folder, label = save
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, label + '.json'), 'w', encoding='utf-8') as f:
                f.write(text)
            if isinstance(result, str) and args[1] in ('procedure_pseudo_code', 'procedure_assembly'):
                target = os.path.join(folder, label + ('.c' if args[1] == 'procedure_pseudo_code' else '.asm'))
                with open(target, 'w', encoding='utf-8') as f:
                    f.write(result)
                print('%s : %d lignes dans %s' % (label, len(result.splitlines()), target))
                sys.exit(0)
        shown = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        print(shown[:limit] + ('\n… (%d caractères en tout)' % len(shown) if len(shown) > limit else ''))
    else:
        print(__doc__)
