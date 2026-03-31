const express = require('express');
const redis = require('./redis.js');

const port = 3000;

const app = express();
app.use(require('cors')());
app.use(express.json());

const db = require('./db.js');
const url = require('./url.js');
const rmq_names = require('./rabbitmq_names.js');
const uuid = require('uuid');

const amqp = require('amqplib');
let connection, channel, exchange;
(async () => {
    connection = await amqp.connect(url.rabbitmq);
    channel = await connection.createChannel();
    exchange = rmq_names.exchange;
    await channel.assertExchange(exchange, 'topic', { durable: true });
})();

const reply_to_queues = {};
async function rabbitmq_send_recv(queue, reply_to, req) {
    const correlationId = uuid.v4();
    let consumer;
    const res = await new Promise((resolve) => {
        consumer = channel.consume(reply_to.queue, (msg) => {
            if (msg.properties.correlationId === correlationId) {
                resolve(JSON.parse(msg.content.toString()));
            }
        }, { noAck: true });
        channel.sendToQueue(queue,
            Buffer.from(JSON.stringify(req)), {
            correlationId: correlationId,
            replyTo: reply_to.queue
        });
    });
    consumer = await consumer;
    await channel.cancel(consumer.consumerTag);
    return res;
};

// ================================================================================================
//    API ENDPOINTS
// ================================================================================================
// -- ROUTE ------------------- | -- Description -------------------- | -- Request json body ------
// FOR ALL USERS: . . . . . . . |. . . . . . . . . . . . . . . . . . .|. . . . . . . . . . . . . . 
// - POST /sign_up              | sign up                             | body: { name: "", password: "" }
// - GET /events                | view all events                     |
// - GET /events/:id            | view event by id                    |
// - GET /booking/:user_id      | view all bookings of user by id     |
// - POST /booking              | create booking                      | body: { user_id: "", event_id: "" }
//                              |                                     |
// FOR ADMINS ONLY: . . . . . . |. . . . . . . . . . . . . . . . . . .|. . . . . . . . . . . . . . 
// - POST /admin/events         | create event                        | body: { name: "", password: "", title: "", date: "", max_num_of_members: 10 }
// - PUT /admin/events/:id      | update event by id                  | body: { name: "", password: "", title: "", date: "", max_num_of_members: 10 }
// - DELETE /admin/events/:id   | delete event by id                  | body: { name: "", password: "" }
// - POST /admin/users          | view all users                      | body: { name: "", password: "" }
// - POST /admin/users/:id      | view user by id                     | body: { name: "", password: "" }
// - POST /admin/booking        | view all bookings                   | body: { name: "", password: "" }


// ================================================================================================
//    USER ROUTES (NO ADMIN REQUIRED)
// ================================================================================================
app.post('/sign_up', async (req, res) => {
    try {
        if (!reply_to_queues.sign_up)
            reply_to_queues.sign_up = await channel.assertQueue(uuid.v4(), { durable: false });

        const res_req = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.sign_up, {
            route: 'sign_up',
            body: req.body
        });

        await redis.del('all_users');

        res.status(res_req.status).json({ message: res_req.message });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.get('/events', async (req, res) => {
    try {
        if (!reply_to_queues.get_event)
            reply_to_queues.get_event = await channel.assertQueue(uuid.v4(), { durable: false });

        const all_events = JSON.parse(await redis.get('all_events'));
        if (all_events != null)
            return res.status(200).json({ message: 'Redis cache hit', data: all_events });

        const res_req = await rabbitmq_send_recv(rmq_names.event_queue, reply_to_queues.get_event, {
            route: 'get_all_events',
            body: {}
        });

        await redis.set('all_events', JSON.stringify(res_req.data));

        res.status(res_req.status).json({ message: res_req.message, data: res_req.data });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.get('/events/:id', async (req, res) => {
    try {
        if (!reply_to_queues.get_event)
            reply_to_queues.get_event = await channel.assertQueue(uuid.v4(), { durable: false });

        const all_events = JSON.parse(await redis.get('all_events'));
        const found = all_events ? all_events.find(i => i._id == req.params.id) : undefined;
        if (all_events != null && found)
            return res.status(200).json({ message: 'Redis cache hit', data: found });

        const res_req = await rabbitmq_send_recv(rmq_names.event_queue, reply_to_queues.get_event, {
            route: 'get_event',
            body: { id: req.params.id }
        });

        res.status(res_req.status).json({ message: res_req.message, data: res_req.data });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.get('/booking/:user_id', async (req, res) => {
    try {
        if (!reply_to_queues.get_user_booking)
            reply_to_queues.get_user_booking = await channel.assertQueue(uuid.v4(), { durable: false });

        const all_bookings = JSON.parse(await redis.get('all_bookings'));
        const found = all_bookings ? all_bookings.find(i => i.user_id == req.params.user_id) : undefined;
        if (all_bookings != null && found)
            return res.status(200).json({ message: 'Redis cache hit', data: found });

        const res_req = await rabbitmq_send_recv(rmq_names.booking_queue, reply_to_queues.get_user_booking, {
            route: 'get_all_user_bookings',
            body: { id: req.params.user_id }
        });

        res.status(res_req.status).json({ message: res_req.message, data: res_req.data });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.post('/booking', async (req, res) => {
    try {
        if (!reply_to_queues.post_booking)
            reply_to_queues.post_booking = await channel.assertQueue(uuid.v4(), { durable: false });

        const res_req = await rabbitmq_send_recv(rmq_names.booking_queue, reply_to_queues.post_booking, {
            route: 'add_booking',
            body: req.body
        });

        await redis.del('all_bookings');

        res.status(res_req.status).json({ message: res_req.message });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ================================================================================================
//    ADMIN ROUTES
// ================================================================================================
app.post('/admin/events', async (req, res) => {
    try {
        if (!reply_to_queues.admin_create_event)
            reply_to_queues.admin_create_event = await channel.assertQueue(uuid.v4(), { durable: false });

        const res_is_admin = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.admin_create_event, {
            route: 'is_admin',
            body: req.body
        });
        if (res_is_admin.status == 400)
            return res.status(400).json({ message: res_is_admin.message });
        if (!res_is_admin.data.is_admin)
            return res.status(400).json({ message: 'Access denied' });

        const res_req = await rabbitmq_send_recv(rmq_names.event_queue, reply_to_queues.admin_create_event, {
            route: 'create_event',
            body: req.body
        });

        await redis.del('all_events');

        res.status(res_req.status).json({ message: res_req.message });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.put('/admin/events/:id', async (req, res) => {
    try {
        if (!reply_to_queues.admin_update_event)
            reply_to_queues.admin_update_event = await channel.assertQueue(uuid.v4(), { durable: false });

        const res_is_admin = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.admin_update_event, {
            route: 'is_admin',
            body: req.body
        });
        if (res_is_admin.status == 400)
            return res.status(400).json({ message: res_is_admin.message });
        if (!res_is_admin.data.is_admin)
            return res.status(400).json({ message: 'Access denied' });

        const res_req = await rabbitmq_send_recv(rmq_names.event_queue, reply_to_queues.admin_update_event, {
            route: 'update_event',
            body: { id: req.params.id, ...req.body }
        });

        await redis.del('all_events');

        res.status(res_req.status).json({ message: res_req.message });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.delete('/admin/events/:id', async (req, res) => {
    try {
        if (!reply_to_queues.admin_delete_events)
            reply_to_queues.admin_delete_events = await channel.assertQueue(uuid.v4(), { durable: false });

        const res_is_admin = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.admin_delete_events, {
            route: 'is_admin',
            body: req.body
        });
        if (res_is_admin.status == 400)
            return res.status(400).json({ message: res_is_admin.message });
        if (!res_is_admin.data.is_admin)
            return res.status(400).json({ message: 'Access denied' });

        const res_req = await rabbitmq_send_recv(rmq_names.event_queue, reply_to_queues.admin_delete_events, {
            route: 'delete_event',
            body: { id: req.params.id }
        });

        await redis.del('all_bookings');

        res.status(200).json({ message: res_req.message });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.post('/admin/users', async (req, res) => {
    try {
        if (!reply_to_queues.admin_users)
            reply_to_queues.admin_users = await channel.assertQueue(uuid.v4(), { durable: false });

        const res_is_admin = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.admin_users, {
            route: 'is_admin',
            body: req.body
        });
        if (res_is_admin.status == 400)
            return res.status(400).json({ message: res_is_admin.message });
        if (res_is_admin.data.is_admin == false)
            return res.status(400).json({ message: 'Access denied' });

        const all_users = JSON.parse(await redis.get('all_users'));
        if (all_users != null)
            return res.status(200).json({ message: 'Redis cache hit', data: all_users })

        const res_req = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.admin_users, {
            route: 'get_all_users',
            body: {}
        });

        await redis.set('all_users', JSON.stringify(res_req.data));

        res.status(200).json({ data: res_req.data });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.post('/admin/users/:id', async (req, res) => {
    try {
        if (!reply_to_queues.admin_users_id)
            reply_to_queues.admin_users_id = await channel.assertQueue(uuid.v4(), { durable: false });

        const res_is_admin = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.admin_users_id, {
            route: 'is_admin',
            body: req.body
        });
        if (res_is_admin.status == 400)
            return res.status(400).json({ message: res_is_admin.message });
        if (!res_is_admin.data.is_admin)
            return res.status(400).json({ message: 'Access denied' });

        const all_users = await JSON.parse(redis.get('all_users'));
        const found = all_users ? all_users.find(i => i._id == req.params.id) : undefined;
        if (all_users != null)
            return res.status(200).json({ message: 'Redis cache hit', data: found })

        const res_req = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.admin_users_id, {
            route: 'get_user',
            body: { id: req.params.id }
        });

        res.status(res_req.status).json({ message: res_req.message, data: res_req.data });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
app.post('/admin/booking', async (req, res) => {
    try {
        if (!reply_to_queues.admin_all_bookings)
            reply_to_queues.admin_all_bookings = await channel.assertQueue(uuid.v4(), { durable: false });

        const res_is_admin = await rabbitmq_send_recv(rmq_names.user_queue, reply_to_queues.admin_all_bookings, {
            route: 'is_admin',
            body: req.body
        });
        if (res_is_admin.status == 400)
            return res.status(400).json({ message: res_is_admin.message });
        if (!res_is_admin.data.is_admin)
            return res.status(400).json({ message: 'Access denied' });

        const all_bookings = JSON.parse(await redis.get('all_bookings'));
        if (all_bookings != null)
            return res.status(200).json({ message: 'Redis cache hit', data: all_bookings });

        const res_req = await rabbitmq_send_recv(rmq_names.booking_queue, reply_to_queues.admin_all_bookings, {
            route: 'get_all_bookings',
            body: {}
        });

        await redis.set('all_bookings', JSON.stringify(res_req.data));

        res.status(res_req.status).json({ data: res_req.data });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});


app.listen(port, '0.0.0.0', () => {
    console.log(`Main API running`);
});