from flask import Flask, request, jsonify, render_template_string
import os, sqlite3, hmac, hashlib, base64, requests, json
from datetime import datetime

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), 'booking.db')
LINE_CHANNEL_SECRET = os.getenv('LINE_CHANNEL_SECRET', '')
LINE_CHANNEL_ACCESS_TOKEN = os.getenv('LINE_CHANNEL_ACCESS_TOKEN', '')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = db()
    con.executescript('''
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      checked_in_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(booking_id) REFERENCES bookings(id)
    );
    ''')
    con.commit(); con.close()


def verify_line(raw_body, signature):
    if not LINE_CHANNEL_SECRET or not signature:
        return False
    digest = hmac.new(LINE_CHANNEL_SECRET.encode(), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, signature)


def line_reply(reply_token, text):
    if not LINE_CHANNEL_ACCESS_TOKEN:
        return
    requests.post(
        'https://api.line.me/v2/bot/message/reply',
        headers={
            'Authorization': f'Bearer {LINE_CHANNEL_ACCESS_TOKEN}',
            'Content-Type': 'application/json'
        },
        json={'replyToken': reply_token, 'messages': [{'type':'text','text':text[:4900]}]},
        timeout=15
    )


def parse_with_gemini(text):
    if not GEMINI_API_KEY:
        return None
    prompt = f'''你是排課系統指令解析器。只輸出 JSON，不要 markdown。
允許 action: search_schedule, create_booking, reschedule_booking, cancel_booking, record_checkin, find_customer, unknown。
不要自行補造缺少的姓名、日期或時間。
格式：{{"summary":"...","actions":[{{"action":"...","customer_name":null,"date_text":null,"time_text":null,"new_date_text":null,"new_time_text":null,"details":""}}],"unresolved_gaps":[],"requires_confirmation":true}}
現在時間：{datetime.now().isoformat()}
使用者指令：{text}'''
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent'
    r = requests.post(
        url,
        headers={'x-goog-api-key': GEMINI_API_KEY, 'Content-Type':'application/json'},
        json={'contents':[{'parts':[{'text':prompt}]}], 'generationConfig':{'responseMimeType':'application/json','temperature':0.1}},
        timeout=30
    )
    if not r.ok:
        raise RuntimeError(f'Gemini {r.status_code}: {r.text[:300]}')
    data = r.json()
    out = ''.join(p.get('text','') for p in data.get('candidates',[{}])[0].get('content',{}).get('parts',[]))
    return json.loads(out)


HOME = '''
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Booking Phone MVP</title>
<style>body{font-family:system-ui;margin:18px;background:#f6f7f8}.card{background:white;padding:16px;border-radius:14px;margin-bottom:12px}input,button{font-size:16px;padding:10px;margin:4px 0;width:100%;box-sizing:border-box}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.ok{color:green}</style></head><body>
<h2>📱 Booking Phone MVP</h2>
<div class="card"><b>狀態</b><br>LINE Secret: {{secret}}<br>LINE Token: {{token}}<br>Gemini: {{gemini}}<br>資料庫：手機本地 SQLite</div>
<div class="card"><h3>新增客戶</h3><form method="post" action="/customers"><input name="name" placeholder="姓名" required><input name="phone" placeholder="電話"><button>新增</button></form></div>
<div class="card"><h3>新增課程</h3><form method="post" action="/bookings"><select name="customer_id" style="width:100%;padding:10px;font-size:16px">{% for c in customers %}<option value="{{c.id}}">{{c.name}}</option>{% endfor %}</select><input name="start_at" type="datetime-local" required><button>排課</button></form></div>
<div class="card"><h3>目前課表</h3><table><tr><th>時間</th><th>客戶</th><th>狀態</th></tr>{% for b in bookings %}<tr><td>{{b.start_at}}</td><td>{{b.name}}</td><td>{{b.status}}</td></tr>{% endfor %}</table></div>
</body></html>
'''


@app.get('/')
def home():
    con = db()
    customers = con.execute('SELECT * FROM customers ORDER BY name').fetchall()
    bookings = con.execute('''SELECT bookings.*, customers.name FROM bookings JOIN customers ON customers.id=bookings.customer_id ORDER BY start_at''').fetchall()
    con.close()
    return render_template_string(HOME, customers=customers, bookings=bookings,
        secret='✅' if LINE_CHANNEL_SECRET else '❌', token='✅' if LINE_CHANNEL_ACCESS_TOKEN else '❌', gemini='✅' if GEMINI_API_KEY else '❌')


@app.post('/customers')
def add_customer():
    con=db(); con.execute('INSERT INTO customers(name,phone) VALUES(?,?)',(request.form['name'], request.form.get('phone'))); con.commit(); con.close()
    return '<script>location.href="/"</script>'


@app.post('/bookings')
def add_booking():
    con=db(); con.execute('INSERT INTO bookings(customer_id,start_at) VALUES(?,?)',(request.form['customer_id'], request.form['start_at'])); con.commit(); con.close()
    return '<script>location.href="/"</script>'


@app.get('/api/state')
def api_state():
    con=db()
    bookings=[dict(x) for x in con.execute('''SELECT bookings.*, customers.name FROM bookings JOIN customers ON customers.id=bookings.customer_id ORDER BY start_at''').fetchall()]
    con.close()
    return jsonify({'ok':True,'bookings':bookings,'lineConfigured':bool(LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN),'geminiConfigured':bool(GEMINI_API_KEY)})


@app.post('/api/line/webhook')
def line_webhook():
    raw=request.get_data()
    if not verify_line(raw, request.headers.get('X-Line-Signature','')):
        return 'Invalid signature',401
    payload=request.get_json(silent=True) or {}
    for event in payload.get('events',[]):
        if event.get('type')=='message' and event.get('message',{}).get('type')=='text':
            text=event['message']['text']; reply_token=event.get('replyToken')
            try:
                plan=parse_with_gemini(text)
                if plan:
                    reply='🧠 已解析（尚未自動執行）\n'+plan.get('summary','')
                else:
                    reply='📱 手機主機已收到：'+text
            except Exception as e:
                reply='⚠️ AI 解析失敗，但手機主機已收到指令。\n'+str(e)[:300]
            if reply_token: line_reply(reply_token, reply)
    return 'OK',200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=8000)
