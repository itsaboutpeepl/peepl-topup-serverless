const serverless = require("serverless-http");
const express = require("express");
const app = express();
const bodyParser = require('body-parser')

// Access config
const config = require('config')
// get function from lodash
const { get } = require('lodash')
// Access stripe
const { stripeClient } = require('@services/stripe')
// Access fuse
const { mintTokensAndSendToken, generateCorrelationId } = require('@utils/fuseApi')

const generateResponse = intent => {
  switch (intent.status) {
    case 'requires_action':
    case 'requires_source_action':
      return {
        requiresAction: true,
        clientSecret: intent.client_secret
      }
    case 'requires_payment_method':
    case 'requires_source':
      return {
        clientSecret: intent.client_secret
      }
    case 'succeeded':
      console.log('💰 Payment received!')
      return { clientSecret: intent.client_secret, requiresAction: false }
  }
}

app.use(bodyParser.urlencoded())
app.use(bodyParser.json())

app.post("/stripe/createPaymentIntent", async (req, res, next) => {
  const { amount, currency = 'gbp', walletAddress } = req.body
  console.log({ amount, currency, walletAddress })
  try {
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount,
      currency,
      metadata: { amount, currency, walletAddress },
      use_stripe_sdk: true
    })
    return res.json({ data: { paymentIntent: generateResponse(paymentIntent) } })
  } catch (error) {
    console.log({ error })
    return res.json({ error })
  }
});

app.post("/stripe/pay", async (req, res, next) => {
  const { amount, currency = 'gbp', paymentMethodId, walletAddress } = req.body
  console.log({ amount, currency, paymentMethodId, walletAddress })
  try {
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount,
      currency,
      metadata: { amount, currency, walletAddress },
      payment_method: paymentMethodId,
      confirm: true,
      use_stripe_sdk: true
    })
    return res.json({ data: { paymentIntent: generateResponse(paymentIntent) } })
  } catch (error) {
    console.log({ error })
    return res.json({ error })
  }
});

app.post("/stripe/webhook", async (req, res, next) => {
  let data, eventType

  if (config.has('stripe.webhookSecret')) {
    let event
    const signature = req.headers['stripe-signature']
    try {
      event = stripeClient.webhooks.constructEvent(
        req.rawBody,
        signature,
        config.get('stripe.webhookSecret')
      )
    } catch (err) {
      console.log({ err })
      return res.sendStatus(400)
    }
    data = event.data.object
    eventType = event.type
  } else {
    data = req.body.data
    eventType = req.body.type
  }

  if (eventType === 'payment_intent.succeeded') {
    console.log('💰 Payment captured!')
    const { amount, walletAddress: toAddress } = get(data, ['charges', 'data', '0', 'metadata'], {})
    console.log(`Minting ${amount} ${toAddress} 💰!`)
    const correlationId = generateCorrelationId()
    await mintTokensAndSendToken({
      correlationId,
      toAddress,
      amount: amount / 100
    })
  } else if (eventType === 'payment_intent.payment_failed') {
    console.log('❌ Payment failed.')
  }
  res.sendStatus(200)
});

router.get('/is_running', (req, res, next) => {
  res.send({ response: 'ok' })
})

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

module.exports.handler = serverless(app);
