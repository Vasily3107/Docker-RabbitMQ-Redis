const amqp = require('amqplib');
const url = require('./url.js');
const rmq_names = require('./rabbitmq_names.js');
const db = require('./db.js');

async function main() {
    const connection = await amqp.connect(url.rabbitmq);
    const channel = await connection.createChannel();

    const queue = rmq_names.booking_queue;
    await channel.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });

    channel.consume(queue, async function reply(msg) {
        const req = JSON.parse(msg.content.toString());
        const res = {};

        const req_body_check = () => {
            if (req.body) return true;
            res.status = 400;
            res.message = 'req.body not found';
            return false;
        }

        const locals = {};

        switch (req.route) {
            case 'get_all_bookings':
                res.status = 200;
                res.data = await db.Booking.find();
                break;


            case 'get_all_user_bookings':
                if (!req_body_check()) break;
                if (!req.body.id) {
                    res.status = 400;
                    res.message = 'Missing user id'
                    break;
                }
                res.status = 200;
                res.data = await db.Booking.find({ user_id: req.body.id });
                break;


            case 'add_booking':
                if (!req_body_check()) break;
                if (!req.body.user_id || !req.body.event_id) {
                    res.status = 400;
                    res.message = 'Missing user id or event id'
                    break;
                }
                locals.user = await db.User.findById(req.body.user_id);
                locals.event = await db.Event.findById(req.body.event_id);

                if (!locals.user) {
                    res.status = 400;
                    res.message = 'User does not exist'
                    break;
                }
                if (!locals.event) {
                    res.status = 400;
                    res.message = 'Event does not exist'
                    break;
                }

                if ((await db.Booking.find({ event_id: req.body.event_id })).length == locals.event.max_num_of_members) {
                    res.status = 400;
                    res.message = 'Event is fully booked'
                    break;
                }
                if (await db.Booking.findOne({ event_id: req.body.event_id, user_id: req.body.user_id })) {
                    res.status = 400;
                    res.message = 'You already booked this event'
                    break;
                }

                res.status = 200;
                res.message = 'Booked'
                await db.Booking.create({ user_id: req.body.user_id, event_id: req.body.event_id });
                break;


            case 'delete_booking':
                if (!req_body_check()) break;
                if (!req.body.id) {
                    res.status = 400;
                    res.message = 'Missing booking id'
                    break;
                }
                res.status = 200;
                res.data = await db.Booking.findByIdAndDelete(req.body.id);
                break;


            default:
                res.status = 400;
                res.message = `BOOKING SERVICE: Unknown route: ${req.route}`;
        }

        channel.sendToQueue(msg.properties.replyTo,
            Buffer.from(JSON.stringify(res)), {
            correlationId: msg.properties.correlationId
        });

        channel.ack(msg);
    }).then(() => {
        console.log('Booking service started');
    });
}

main();